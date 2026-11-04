// Package requestlog records HTTP outcomes and correlates service-boundary errors.
package requestlog

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"log/slog"
	"net/http"
	"path"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5/middleware"
)

// RequestIDHeader carries diagnostic correlation across trusted service hops.
const RequestIDHeader = "X-Request-ID"

type contextKey struct{}

type entry struct {
	logger         *slog.Logger
	attrs          map[string]any
	errorLevel     slog.Level
	routine        bool
	authChallenge  bool
	clientCanceled bool
	callerContext  context.Context
	requestID      string
	traceparent    string
	method         string
	path           string
	mu             sync.Mutex
}

// Middleware records fields rather than formatted URLs. Headers, query values,
// bodies and capability-bearing research paths are never included.
// Existing trace context is recorded; this middleware does not create spans.
func Middleware(logger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		handler := middleware.Recoverer(next)
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			id := r.Header.Get(RequestIDHeader)
			if !validRequestID(id) {
				id = rand.Text()
			}
			e := &entry{logger: logger, requestID: id, method: r.Method, path: safePath(r.URL.Path), errorLevel: slog.LevelDebug, callerContext: r.Context()}
			if validTraceparent(r.Header.Get("Traceparent")) {
				e.traceparent = r.Header.Get("Traceparent")
			}
			w.Header().Set(RequestIDHeader, id)
			r = r.WithContext(context.WithValue(r.Context(), contextKey{}, e))
			record := &logEntry{ctx: r.Context(), method: r.Method, path: r.URL.Path, websocketUpgrade: isWebSocketUpgrade(r.Header)}
			wrapped := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
			started := time.Now()
			completed := false
			defer func() {
				status := wrapped.Status()
				// Returning without writing a status sends an implicit 200, including after a flush.
				if completed && status == 0 && !record.hijacked {
					status = http.StatusOK
				}
				record.Write(status, wrapped.BytesWritten(), wrapped.Header(), time.Since(started), nil)
			}()
			handler.ServeHTTP(observeHijacks(wrapped, record), middleware.WithLogEntry(r, record))
			completed = true
		})
	}
}

// Add attaches trusted, resolved domain identity to both request and error logs.
// Do not call it with request bodies, credentials or unverified identity headers.
func Add(ctx context.Context, attrs ...any) {
	if e, ok := ctx.Value(contextKey{}).(*entry); ok {
		e.mu.Lock()
		if e.attrs == nil {
			e.attrs = make(map[string]any)
		}
		for index := 0; index+1 < len(attrs); index += 2 {
			if key, ok := attrs[index].(string); ok {
				e.attrs[key] = attrs[index+1]
			}
		}
		e.mu.Unlock()
	}
}

// Routine declares a route's successful completions as DEBUG. Failures and
// confirmed caller cancellations retain their usual severity.
func Routine(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		MarkRoutine(r.Context())
		next.ServeHTTP(w, r)
	})
}

// MarkRoutine applies the same policy inside a generated RPC handler or the
// read branch of an endpoint that also accepts writes.
func MarkRoutine(ctx context.Context) {
	if e, ok := ctx.Value(contextKey{}).(*entry); ok {
		e.mu.Lock()
		e.routine = true
		e.mu.Unlock()
	}
}

// AuthenticationChallenge marks a credential-free Git discovery challenge.
// Rejected credentials must never use this classification.
func AuthenticationChallenge(ctx context.Context) {
	Add(ctx, "auth_outcome", "challenge")
	if e, ok := ctx.Value(contextKey{}).(*entry); ok {
		e.mu.Lock()
		e.authChallenge = true
		e.mu.Unlock()
	}
}

// Logger returns the request's correlated logger or the process logger outside HTTP.
func Logger(ctx context.Context) *slog.Logger {
	e, ok := ctx.Value(contextKey{}).(*entry)
	if !ok {
		return slog.Default()
	}
	attrs := []any{"request_id", e.requestID, "method", e.method, "path", e.path}
	if e.traceparent != "" {
		attrs = append(attrs, "trace_id", e.traceparent[3:35])
	}
	e.mu.Lock()
	for key, value := range e.attrs {
		attrs = append(attrs, key, value)
	}
	e.mu.Unlock()
	return e.logger.With(attrs...)
}

// Forward copies only validated correlation from the current request context.
// These fields are diagnostic and never convey authorization.
func Forward(ctx context.Context, header http.Header) {
	if e, ok := ctx.Value(contextKey{}).(*entry); ok {
		header.Set(RequestIDHeader, e.requestID)
		header.Del("Traceparent")
		if e.traceparent != "" {
			header.Set("Traceparent", e.traceparent)
		}
	}
}

type logEntry struct {
	ctx              context.Context
	method           string
	path             string
	websocketUpgrade bool
	hijacked         bool
}

// Write records the completed HTTP outcome.
func (e *logEntry) Write(status, bytes int, header http.Header, elapsed time.Duration, _ any) {
	// ReverseProxy writes the 101 directly after a successful hijack.
	if status == 0 && e.hijacked && e.websocketUpgrade && isWebSocketUpgrade(header) {
		status = http.StatusSwitchingProtocols
	}
	if e.method == http.MethodGet && status < http.StatusBadRequest && isProbe(e.path) {
		return
	}
	level := slog.LevelInfo
	if status < http.StatusBadRequest && isStaticAsset(e.method, header.Get("Content-Type")) {
		level = slog.LevelDebug
	}
	if status >= http.StatusInternalServerError {
		level = slog.LevelError
	} else if status >= http.StatusBadRequest {
		level = slog.LevelWarn
	}
	if request, ok := e.ctx.Value(contextKey{}).(*entry); ok {
		request.mu.Lock()
		if request.routine && status < http.StatusBadRequest {
			level = slog.LevelDebug
		}
		if request.clientCanceled {
			level = slog.LevelInfo
		} else if request.authChallenge && status == http.StatusUnauthorized {
			level = slog.LevelDebug
		}
		level = max(level, request.errorLevel)
		request.mu.Unlock()
	}
	Logger(e.ctx).Log(e.ctx, level, "http request completed", "status", status, "response_bytes", bytes, "duration_ms", float64(elapsed)/float64(time.Millisecond))
}

// Panic records the failure without exposing arbitrary panic data.
func (e *logEntry) Panic(value any, _ []byte) {
	// Keep the panic marker consumed by preview health reporting, while
	// omitting arbitrary panic values and function arguments.
	Logger(e.ctx).ErrorContext(e.ctx, "panic: http handler panicked", "panic_type", fmt.Sprintf("%T", value), "stack", sourceStack())
}

// Static response types are routine; HTML navigation and API responses remain visible.
func isStaticAsset(method, contentType string) bool {
	if method != http.MethodGet && method != http.MethodHead {
		return false
	}
	contentType, _, _ = strings.Cut(contentType, ";")
	switch contentType {
	case "text/css", "text/javascript", "application/javascript":
		return true
	}
	return strings.HasPrefix(contentType, "image/") || strings.HasPrefix(contentType, "font/")
}

func isProbe(path string) bool {
	return path == "/healthz" || path == "/api/health" || path == "/api/ready" || path == "/api/authority/ready"
}

func safePath(requestPath string) string {
	if strings.HasPrefix(requestPath, "/research/") || strings.HasPrefix(path.Clean(requestPath), "/research/") {
		return "/research/<redacted>"
	}
	return requestPath
}

func validRequestID(id string) bool {
	if len(id) == 0 || len(id) > 128 {
		return false
	}
	for _, c := range id {
		if (c < 'a' || c > 'z') && (c < 'A' || c > 'Z') && (c < '0' || c > '9') && c != '-' && c != '_' && c != '.' {
			return false
		}
	}
	return true
}

func validTraceparent(value string) bool {
	if len(value) != 55 || !strings.HasPrefix(value, "00-") || value[35] != '-' || value[52] != '-' || strings.ToLower(value) != value {
		return false
	}
	for _, segment := range []string{value[3:35], value[36:52], value[53:55]} {
		if _, err := hex.DecodeString(segment); err != nil {
			return false
		}
	}
	return value[3:35] != strings.Repeat("0", 32) && value[36:52] != strings.Repeat("0", 16)
}
