// Package server provides the base HTTP server functionality for Ark applications
package server

import (
	"context"
	"embed"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"net"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/defenseunicorns/ark/framework/go/pkg/readiness"
	"github.com/defenseunicorns/ark/framework/go/pkg/requestlog"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

// Server represents an Ark application server
type Server struct {
	Router *chi.Mux
	Config *Config
	Logger *slog.Logger
}

// Config holds server configuration
// Note: TLS is handled by UDS/Istio automatically
type Config struct {
	Address      string        `yaml:"address" mapstructure:"address"`
	ReadTimeout  time.Duration `yaml:"readTimeout" mapstructure:"readTimeout"`
	WriteTimeout time.Duration `yaml:"writeTimeout" mapstructure:"writeTimeout"`
	IdleTimeout  time.Duration `yaml:"idleTimeout" mapstructure:"idleTimeout"`
	// StreamWriteTimeout bounds individual Connect/gRPC writes and flushes.
	StreamWriteTimeout time.Duration `yaml:"streamWriteTimeout" mapstructure:"streamWriteTimeout"`
}

// New creates a new Ark server instance
func New(config *Config, logger *slog.Logger) *Server {
	r := chi.NewRouter()

	// Shared request logging includes recovery and preserves streaming writers.
	r.Use(requestlog.Middleware(logger))
	r.Use(middleware.Compress(5))
	r.Use(StreamWriteTimeout(config.StreamWriteTimeout))
	// Note: middleware.Timeout is intentionally omitted here, AND
	// http.Server.WriteTimeout is 0 in DefaultConfig (see below). Both are
	// guillotines for long-lived server-streams:
	//   - chi's Timeout middleware cancels the request context after the
	//     deadline, killing a stream even while data is actively flowing.
	//   - http.Server.WriteTimeout is an ABSOLUTE cap on the whole response,
	//     set when the request headers are read and never reset per write/flush.
	//     A 30m value silently severs every server-stream (conversation,
	//     backlog, build progress) at the 30-minute mark — the bug behind the
	//     "red disconnect after a while, especially once the build is idle."
	// StreamWriteTimeout bounds stalled writes without capping stream lifetimes.
	// So streaming correctness requires WriteTimeout: 0. Request-side slowloris
	// is still bounded by ReadHeaderTimeout (1m) + ReadTimeout; the only request
	// bodies are unary (no client-streaming RPCs exist), so capping reads is safe.

	return &Server{
		Router: r,
		Config: config,
		Logger: logger,
	}
}

// defaultEmbedSubDir is the convention every generated app follows:
// `//go:embed all:ui/build` at the package root. The handler does
// fs.Sub(assets, "ui/build") so requests resolve against the build
// root, not the embed prefix. Without the Sub, "/" looks up
// `index.html` at the embed root and misses (the file lives at
// `ui/build/index.html`), which makes http.FileServer canonicalize
// "/" to "./" in an infinite redirect loop. That bit two builds
// before the Sub landed; the regression is pinned by
// TestServeStatic_NoRedirectLoopOnRoot.
const defaultEmbedSubDir = "ui/build"

// ServeStatic sets up static file serving from embedded FS with SPA fallback.
// Any path that doesn't match a real file returns index.html, enabling
// client-side routing (react-router, etc.) without hash fragments.
//
// Conventions assumed:
//   - The caller embeds with `//go:embed all:ui/build` (or `//go:embed ui/build`).
//   - urlPrefix is the URL prefix at which the assets are served, typically "/".
func (s *Server) ServeStatic(assets *embed.FS, urlPrefix string) {
	s.ServeStaticFromDir(assets, defaultEmbedSubDir, urlPrefix)
}

// ServeStaticFromDir is ServeStatic with an explicit embed sub-directory,
// for tests or unusual embed layouts. Production code path should use
// ServeStatic.
func (s *Server) ServeStaticFromDir(assets *embed.FS, embedDir, urlPrefix string) {
	s.Router.Handle(urlPrefix+"*", spaHandler(assets, embedDir, urlPrefix))
}

// ServeStaticDir serves the SPA from a real filesystem directory rather than an
// embedded FS. Used in dev (ARK_UI_DIR): a `bun --watch` rebuild of ui/build is
// picked up live on the next request — no re-embed, no binary rebuild, no
// wizard restart. dir is the build root (contains index.html).
//
// Assets are served no-store: the dev bundle has stable filenames (main.js /
// styles.css, no content hash), so without it the browser heuristically caches
// the old bundle after a rebuild and you'd have to hard-refresh to see changes.
func (s *Server) ServeStaticDir(dir, urlPrefix string) {
	h := spaHandlerFS(os.DirFS(dir), urlPrefix)
	s.Router.Handle(urlPrefix+"*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		h.ServeHTTP(w, r)
	}))
}

// spaHandler serves static files from an embedded FS. If the requested path
// doesn't exist (e.g. /workspace/abc123), it serves index.html so the
// client-side router can handle the route.
func spaHandler(assets *embed.FS, embedDir, urlPrefix string) http.Handler {
	// fs.Sub into the build directory so paths resolve against the
	// build root, not the embed prefix. On any error (the convention
	// subdir doesn't exist) fall back to the raw embed.FS so unusual
	// layouts still serve something rather than 404'ing the whole UI.
	var fsys fs.FS = assets
	if embedDir != "" {
		if sub, err := fs.Sub(assets, embedDir); err == nil {
			// Confirm the subdir has an index.html before committing
			// to it; otherwise the caller's embed didn't follow the
			// convention and the raw root is the better default.
			if f, openErr := sub.Open("index.html"); openErr == nil {
				_ = f.Close()
				fsys = sub
			}
		}
	}

	return spaHandlerFS(fsys, urlPrefix)
}

// spaHandlerFS is the SPA file handler over any fs.FS — an embedded FS
// (production) or os.DirFS (dev, via ServeStaticDir). Unknown paths fall back to
// index.html so the client-side router owns the URL.
func spaHandlerFS(fsys fs.FS, urlPrefix string) http.Handler {
	fileServer := http.FileServer(http.FS(fsys))
	stripped := http.StripPrefix(strings.TrimSuffix(urlPrefix, "/"), fileServer)

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Translate the request URL into an FS-relative path so we can
		// probe the embedded FS without touching net/http's canonicalization.
		fsPath := strings.TrimPrefix(r.URL.Path, urlPrefix)
		fsPath = strings.TrimPrefix(fsPath, "/")
		if fsPath == "" {
			fsPath = "index.html"
		}

		if f, err := fsys.Open(fsPath); err == nil {
			_ = f.Close()
			stripped.ServeHTTP(w, r)

			return
		}

		// File not found — serve index.html so the client-side router
		// owns the URL. We write the body directly rather than rewriting
		// r.URL.Path and re-dispatching: the latter risks the FileServer
		// 301-redirecting non-canonical paths back to "./", which races
		// the SPA mount and produces a redirect loop.
		body, readErr := fs.ReadFile(fsys, "index.html")
		if readErr != nil {
			http.Error(w, "UI not built", http.StatusNotFound)

			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		// no-cache so the SPA shell always fetches the latest hashed
		// asset references after a workspace rebuild.
		w.Header().Set("Cache-Control", "no-cache")
		_, _ = w.Write(body)
	})
}

// AddRoutes adds routes to the server using a configuration function
func (s *Server) AddRoutes(configureRoutes func(*chi.Mux)) {
	configureRoutes(s.Router)
}

// Start binds before announcing readiness, then serves until ctx is canceled.
// The caller owns OS signal handling, including during preview execution.
func (s *Server) Start(ctx context.Context) error {
	listener, err := s.listen(ctx)
	if err != nil {
		return err
	}
	defer listener.Close() //nolint:errcheck // Serve/Shutdown owns the meaningful listener error.
	srv := &http.Server{Addr: listener.Addr().String(), Handler: s.Router, ReadTimeout: s.Config.ReadTimeout, WriteTimeout: s.Config.WriteTimeout, IdleTimeout: s.Config.IdleTimeout, ReadHeaderTimeout: time.Minute}
	done := make(chan error, 1)
	go func() {
		s.Logger.Info("Starting Ark server", "address", listener.Addr().String())
		err := srv.Serve(listener)
		if errors.Is(err, http.ErrServerClosed) {
			err = nil
		}
		done <- err
	}()
	select {
	case err := <-done:
		if err != nil {
			return fmt.Errorf("server error: %w", err)
		}

		return nil
	case <-ctx.Done():
		s.Logger.Info("Shutting down Ark server")
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		err := srv.Shutdown(shutdownCtx)
		if err != nil {
			_ = srv.Close() //nolint:errcheck // force close after Shutdown already returned its error.
		}
		<-done
		if err != nil {
			return fmt.Errorf("error shutting down server: %w", err)
		}
		return nil
	}
}

func (s *Server) listen(ctx context.Context) (net.Listener, error) {
	report, err := readiness.Open()
	if err != nil {
		return nil, fmt.Errorf("startup readiness: %w", err)
	}
	address := s.Config.Address
	if address == "" {
		address = ":http"
	}
	if report != nil {
		defer report.Close() //nolint:errcheck // a failed Report is returned; always release the inherited descriptor.
		_, port, err := net.SplitHostPort(address)
		if err != nil || port != "0" {
			return nil, fmt.Errorf("startup readiness requires PORT=0")
		}
		address = "127.0.0.1:0"
	}
	listener, err := (&net.ListenConfig{}).Listen(ctx, "tcp", address)
	if err != nil {
		return nil, fmt.Errorf("bind server listener: %w", err)
	}
	if report != nil {
		if err := readiness.Report(report, listener.Addr()); err != nil {
			_ = listener.Close() //nolint:errcheck // close the bound listener after a failed handshake.

			return nil, fmt.Errorf("announce startup listener: %w", err)
		}
	}

	return listener, nil
}

// DefaultConfig returns default server configuration
func DefaultConfig() *Config {
	return &Config{
		Address:     "0.0.0.0:8080",
		ReadTimeout: 15 * time.Minute,
		// WriteTimeout MUST be 0 (no deadline): it is an absolute cap on the
		// entire response, so any positive value hard-kills long-lived
		// server-streams at that mark regardless of activity. See the comment
		// in NewServer. Streaming is the default shape of an Ark app, so this
		// is a framework-wide invariant, not a wizard-only one.
		WriteTimeout:       0,
		IdleTimeout:        30 * time.Minute,
		StreamWriteTimeout: 2 * time.Second,
	}
}
