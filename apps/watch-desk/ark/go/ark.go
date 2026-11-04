// Package ark provides the main framework functionality for Ark applications
package ark

import (
	"context"
	"embed"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"

	"buf.build/go/protovalidate"
	"connectrpc.com/connect"
	"github.com/defenseunicorns/ark/framework/go/pkg/connectrpc"
	"github.com/defenseunicorns/ark/framework/go/pkg/health"
	"github.com/defenseunicorns/ark/framework/go/pkg/requestlog"
	"github.com/defenseunicorns/ark/framework/go/pkg/server"
	"github.com/defenseunicorns/ark/framework/go/pkg/storage"
	"github.com/go-chi/chi/v5"
	"github.com/riverqueue/river"
)

// WorkerInterface defines the interface that River workers must implement
type WorkerInterface interface {
	Kind() string
}

// Application represents an Ark application
type Application struct {
	Server       *server.Server
	Storage      *storage.Storage
	Logger       *slog.Logger
	Services     []connectrpc.ServiceRegistrar
	Workers      *river.Workers
	Health       *health.Service
	validator    protovalidate.Validator // Validates incoming RPC requests against proto rules.
	periodicJobs []*river.PeriodicJob
	workerCount  int // Track how many workers have been added
}

// Config represents the internal application configuration
// This is not exposed - Ark applications use standard configuration
type config struct {
	Server   server.Config
	Database storage.Config
	Queue    queueConfig
}

type queueConfig struct {
	Enabled bool
}

// defaultSQLitePath returns an ABSOLUTE default SQLite path in a writable state
// dir, so an Ark app never silently writes (or fails to open) "./app.db"
// relative to whatever cwd it happened to launch from. Override with DATABASE_URL.
// Precedence: $ARK_DATA_DIR, $XDG_STATE_HOME/ark, $HOME/.local/state/ark, then a
// temp dir as a last resort.
func defaultSQLitePath() string {
	base := os.Getenv("ARK_DATA_DIR")
	if base == "" {
		if xdg := os.Getenv("XDG_STATE_HOME"); xdg != "" {
			base = filepath.Join(xdg, "ark")
		} else if home, err := os.UserHomeDir(); err == nil {
			base = filepath.Join(home, ".local", "state", "ark")
		} else {
			base = filepath.Join(os.TempDir(), "ark")
		}
	}

	return filepath.Join(base, "app.db")
}

// NewApplication creates a new Ark application with standard configuration
func NewApplication(logger *slog.Logger) (*Application, error) {
	// Standard configuration for all Ark applications
	config := &config{
		Server: *server.DefaultConfig(),
		Database: storage.Config{
			Type:             storage.DBTypeSQLite,
			ConnectionString: defaultSQLitePath(),
		},
		Queue: queueConfig{
			Enabled: true,
		},
	}

	// Allow environment variables to override
	if dbURL := os.Getenv("DATABASE_URL"); dbURL != "" {
		config.Database.ConnectionString = dbURL
		if strings.HasPrefix(dbURL, "postgres://") || strings.HasPrefix(dbURL, "postgresql://") {
			config.Database.Type = storage.DBTypePostgres
		}
	}

	// For a SQLite plain-path DSN, never trust cwd: make a relative path absolute
	// and ensure its parent dir exists. Turns SQLite's cryptic "unable to open
	// database file (14)" (when cwd isn't writable) into a clear, actionable error.
	if config.Database.Type == storage.DBTypeSQLite &&
		!strings.Contains(config.Database.ConnectionString, "://") &&
		!strings.HasPrefix(config.Database.ConnectionString, "file:") {
		p := config.Database.ConnectionString
		if !filepath.IsAbs(p) {
			if abs, absErr := filepath.Abs(p); absErr == nil {
				p = abs
			}
		}
		if mkErr := os.MkdirAll(filepath.Dir(p), 0o750); mkErr != nil {
			return nil, fmt.Errorf("create SQLite data dir %s (set DATABASE_URL to an absolute writable path): %w", filepath.Dir(p), mkErr)
		}
		config.Database.ConnectionString = p
	}

	if port := os.Getenv("PORT"); port != "" {
		config.Server.Address = "0.0.0.0:" + port
	}

	// Initialize storage
	store, err := storage.NewStorage(config.Database.Type, config.Database.ConnectionString)
	if err != nil {
		return nil, fmt.Errorf("failed to initialize storage: %w", err)
	}

	// Initialize server
	srv := server.New(&config.Server, logger)

	// Initialize workers
	workers := river.NewWorkers()

	// Initialize health service
	healthService := health.NewService("Ark Application", "1.0.0")

	// Initialize protovalidate validator once — it's thread-safe and reusable.
	validator, err := protovalidate.New()
	if err != nil {
		return nil, fmt.Errorf("initializing validator: %w", err)
	}

	return &Application{
		Server:    srv,
		Storage:   store,
		Logger:    logger,
		Workers:   workers,
		Health:    healthService,
		validator: validator,
	}, nil
}

// AddService registers a ConnectRPC service with the application
func (app *Application) AddService(service connectrpc.ServiceRegistrar) {
	app.Services = append(app.Services, service)
}

// AddWorker counts a previously registered River worker to enable background jobs
// when Start is called. First register the typed worker with
// river.AddWorker(app.Workers, worker); AddWorker does not populate the registry
// or validate the worker's type. Call it once per worker before Start.
func (app *Application) AddWorker(worker any) error {
	if worker == nil {
		return fmt.Errorf("worker cannot be nil")
	}

	app.workerCount++
	return nil
}

// AddTypedWorker provides a type-safe alternative for specific job types
func (app *Application) AddTypedWorker(worker WorkerInterface) error {
	if worker == nil {
		return fmt.Errorf("worker cannot be nil")
	}

	// For now, we simplify this by just checking the interface
	// River workers will be added directly to Workers when needed
	app.workerCount++
	return nil
}

// AddPeriodicJob registers a River-owned periodic job for application startup.
func (app *Application) AddPeriodicJob(job *river.PeriodicJob) error {
	if job == nil {
		return fmt.Errorf("periodic job cannot be nil")
	}
	app.periodicJobs = append(app.periodicJobs, job)

	return nil
}

// ServeStatic configures static file serving
func (app *Application) ServeStatic(assets *embed.FS, prefix string) {
	app.Server.ServeStatic(assets, prefix)
}

// ServeStaticDir serves the SPA from a filesystem directory (dev: ARK_UI_DIR)
// instead of an embedded FS, so UI rebuilds are live without re-embedding.
func (app *Application) ServeStaticDir(dir, prefix string) {
	app.Server.ServeStaticDir(dir, prefix)
}

// ConfigureRoutes allows custom route configuration
func (app *Application) ConfigureRoutes(configFunc func(*chi.Mux)) {
	app.Server.AddRoutes(configFunc)
}

// Start serves until ctx is canceled; callers must call Stop to drain background jobs.
func (app *Application) Start(ctx context.Context) error {
	// Older application-owned entrypoints pass Background and relied on the
	// framework for signal handling. Cancellable callers retain their ownership.
	if ctx.Done() == nil {
		var stop context.CancelFunc
		ctx, stop = applicationSignalContext(ctx)
		defer stop()
	}
	// Only initialize River if we have workers to register
	// This allows applications to start without background jobs
	if app.hasWorkers() {
		// HTTP cancellation begins draining requests. Keep River jobs alive until
		// Stop runs after that drain, so in-flight handlers can still enqueue work.
		if err := app.Storage.InitializeRiverWithLifetime(ctx, context.WithoutCancel(ctx), app.Workers, app.periodicJobs...); err != nil {
			return fmt.Errorf("failed to initialize river: %w", err)
		}
		app.Logger.Info("Background job processing enabled")
	} else {
		app.Logger.Info("No workers registered - background job processing disabled")
	}

	// Register health endpoints (always available)
	app.Health.RegisterRoutes(app.Server.Router)

	// Register all ConnectRPC services with the validator interceptor so
	// every incoming request is checked against its proto schema rules
	// before reaching the handler.
	globalInterceptors := []connect.Interceptor{
		requestlog.Interceptor(),
		connectrpc.ValidationInterceptor(app.validator),
	}
	connectrpc.RegisterServices(app.Server.Router, app.Services, globalInterceptors...)

	// Start the server
	return app.Server.Start(ctx)
}

// hasWorkers checks if any workers have been registered
func (app *Application) hasWorkers() bool {
	return app.workerCount > 0
}

// Stop gracefully stops the application
func (app *Application) Stop() error {
	return app.Storage.Close()
}
