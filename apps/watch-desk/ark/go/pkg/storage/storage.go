// Package storage provides database storage functionality for Ark applications
package storage

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"net/url"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/riverdriver/riverpgxv5"
)

// sqliteDirPerm is the permission bits for SQLite database directories
// created by ensureSQLiteParentDir. 0o750 = owner rwx, group rx, others
// none — matches uds-registry's convention.
const sqliteDirPerm = 0o750

// extractSQLitePath decodes a SQLite file URI once while preserving plain paths.
// Hierarchical URL Path is already decoded by url.Parse; opaque file:relative
// paths require PathUnescape. In-memory DSNs remain :memory:.
func extractSQLitePath(connectionString string) (string, error) {
	if !strings.HasPrefix(connectionString, "file:") {
		return connectionString, nil
	}
	parsed, err := url.Parse(connectionString)
	if err != nil {
		return "", fmt.Errorf("parse SQLite file URI: %w", err)
	}
	if parsed.Host != "" && parsed.Host != "localhost" {
		return "", fmt.Errorf("SQLite file URI has unsupported host %q", parsed.Host)
	}
	if _, err := url.ParseQuery(parsed.RawQuery); err != nil {
		return "", fmt.Errorf("parse SQLite file URI options: %w", err)
	}
	if parsed.Opaque == "" {
		return parsed.Path, nil
	}
	path, err := url.PathUnescape(parsed.Opaque)
	if err != nil {
		return "", fmt.Errorf("decode SQLite file URI path: %w", err)
	}
	return path, nil
}

// ensureSQLiteParentDir creates the parent directory of a SQLite
// connection string's file path if it doesn't exist. Skips for
// `:memory:`, empty paths, and paths whose dir is "." or matches the
// path itself (i.e. files in the current directory). Matches the
// pattern uds-registry uses to avoid `sql.Open` crashes when a
// configured DSN points at a non-existent dir like `./data/app.db`.
func ensureSQLiteParentDir(connectionString string) error {
	path, err := extractSQLitePath(connectionString)
	if err != nil {
		return err
	}
	if path == "" || path == ":memory:" {
		return nil
	}
	dirPath := filepath.Dir(path)
	if dirPath == "" || dirPath == "." || dirPath == path {
		return nil // file in cwd; no parent dir to create
	}

	if _, err := os.Stat(dirPath); err == nil {
		return nil // already exists
	} else if !os.IsNotExist(err) {
		return fmt.Errorf("stat sqlite parent dir %s: %w", dirPath, err)
	}
	if err := os.MkdirAll(dirPath, sqliteDirPerm); err != nil {
		return fmt.Errorf("create sqlite parent dir %s: %w", dirPath, err)
	}

	return nil
}

// Database type constants. DBTypeSQLite maps to the pure-Go "sqlite" driver
// from glebarez — no CGO, important for air-gap distribution.
const (
	DBTypeSQLite   = "sqlite"
	DBTypePostgres = "postgres"
)

// Storage provides database and queue functionality for Ark applications
type Storage struct {
	River            QueueClient // Type-safe queue client interface
	RiverDriver      RiverDriver // Type-safe River driver interface
	DBType           string
	entClient        any // Raw ENT client for type-safe access via EntClient().
	riverClose       func() error
	entClose         func() error
	connectionString string
	riverMu          sync.Mutex
	sqliteMu         sync.Mutex
	sqliteDB         *sql.DB
	sqliteClosed     bool
}

// Config holds database configuration
type Config struct {
	Type             string `yaml:"type" mapstructure:"type"`
	ConnectionString string `yaml:"connectionString" mapstructure:"connectionString"`
}

// NewStorage creates a new storage instance
func NewStorage(dbType, connectionString string) (*Storage, error) {
	// Register appropriate driver
	if err := registerDriver(dbType); err != nil {
		return nil, fmt.Errorf("failed to register driver: %w", err)
	}

	// Validate connection string
	if err := checkConnectionString(dbType, connectionString); err != nil {
		return nil, fmt.Errorf("invalid connection string: %w", err)
	}

	// Create the parent directory for SQLite file-backed DBs before
	// the driver tries to open the file. Avoids `sql.Open` crashes
	// when a configured DSN points at a non-existent dir like
	// `file:./data/app.db`. No-op for in-memory or cwd-relative paths.
	if dbType == DBTypeSQLite {
		if err := ensureSQLiteParentDir(connectionString); err != nil {
			return nil, fmt.Errorf("ensure sqlite parent dir: %w", err)
		}
	}

	storage := &Storage{
		DBType:           dbType,
		connectionString: connectionString,
	}

	return storage, nil
}

// InitializeRiver initializes the River queue client
func (s *Storage) InitializeRiver(
	ctx context.Context,
	workers *river.Workers,
	periodicJobs ...*river.PeriodicJob,
) error {
	return s.InitializeRiverWithLifetime(ctx, ctx, workers, periodicJobs...)
}

// InitializeRiverWithLifetime uses ctx for synchronous database setup and
// workerCtx for background processing. Applications can keep workers alive while
// HTTP requests drain without detaching cancellable startup. Close stops workers.
func (s *Storage) InitializeRiverWithLifetime(
	ctx, workerCtx context.Context,
	workers *river.Workers,
	periodicJobs ...*river.PeriodicJob,
) error {
	// NewStorage deliberately does not open a queue connection or migrate River.
	// Most generated applications do not register background workers, and Ark's
	// own runtime is database-free. Defer all queue I/O until Start observes a
	// registered worker and calls InitializeRiver.
	s.riverMu.Lock()
	defer s.riverMu.Unlock()
	if err := ctx.Err(); err != nil {
		return fmt.Errorf("initialize river canceled: %w", err)
	}
	s.sqliteMu.Lock()
	closed := s.sqliteClosed
	s.sqliteMu.Unlock()
	if closed {
		return fmt.Errorf("initialize river: storage is closed")
	}
	if s.RiverDriver == nil {
		driver, closeDriver, err := s.setupRiver(ctx)
		if err != nil {
			return fmt.Errorf("setup river: %w", err)
		}
		s.RiverDriver = driver
		s.riverClose = closeDriver
	}
	if err := ctx.Err(); err != nil {
		return fmt.Errorf("initialize river canceled: %w", err)
	}

	if s.RiverDriver == nil {
		return fmt.Errorf("river driver not initialized")
	}

	config := &river.Config{
		Logger:       slog.Default(),
		PeriodicJobs: periodicJobs,
		Queues: map[string]river.QueueConfig{
			river.QueueDefault: {MaxWorkers: 10},
		},
		Workers: workers,
	}

	switch s.DBType {
	case DBTypePostgres:
		return s.initializePostgresClient(workerCtx, config)
	case DBTypeSQLite:
		return s.initializeSQLiteClient(workerCtx, config)
	default:
		return fmt.Errorf("unsupported database type: %s", s.DBType)
	}
}

// Close closes all connections
func (s *Storage) Close() error {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	return s.closeContext(ctx)
}

func (s *Storage) closeContext(ctx context.Context) error {
	var errs []error

	// Stop River client
	if s.River != nil {
		if err := s.River.Stop(ctx); err != nil {
			errs = append(errs, fmt.Errorf("failed to stop river client: %w", err))
			if errors.Is(err, errQueueShutdownIncomplete) {
				// A worker may still own a connection. Closing its pool can block
				// indefinitely; retain it rather than defeat the shutdown budget.
				return fmt.Errorf("queue shutdown did not complete: %w", errors.Join(errs...))
			}
		}
	}

	// Close River connection
	if s.riverClose != nil {
		if err := s.riverClose(); err != nil {
			errs = append(errs, fmt.Errorf("failed to close river connection: %w", err))
		}
	}

	// Close the registered ENT client.
	if s.entClose != nil {
		if err := s.entClose(); err != nil {
			errs = append(errs, fmt.Errorf("failed to close ent client: %w", err))
		}
	}

	if err := s.closeSQLiteDB(); err != nil {
		errs = append(errs, err)
	}

	if len(errs) == 0 {
		return nil
	}

	return fmt.Errorf("errors during close: %w", errors.Join(errs...))
}

// registerDriver ensures the appropriate database driver is registered
func registerDriver(dbType string) error {
	switch dbType {
	case DBTypeSQLite:
		// SQLite registration handled by import
		return nil
	case DBTypePostgres:
		return registerPostgres()
	default:
		return fmt.Errorf("unsupported database type: %s", dbType)
	}
}

// registerPostgres registers the PostgreSQL driver if not already registered
func registerPostgres() error {
	if slices.Contains(sql.Drivers(), DBTypePostgres) {
		return nil // Already registered
	}
	sql.Register(DBTypePostgres, &stdlib.Driver{})
	return nil
}

// checkConnectionString validates the connection string format
func checkConnectionString(dbType, connectionString string) error {
	switch dbType {
	case DBTypePostgres:
		if !strings.HasPrefix(connectionString, "postgres://") &&
			!strings.HasPrefix(connectionString, "postgresql://") {
			return fmt.Errorf("postgres connection string must start with postgres:// or postgresql://")
		}
	case DBTypeSQLite:
		// SQLite connection strings are file paths, allow any non-empty string
		if connectionString == "" {
			return fmt.Errorf("sqlite connection string cannot be empty")
		}
	default:
		return fmt.Errorf("unsupported database type: %s", dbType)
	}
	return nil
}

// setupRiver initializes River based on database type
func (s *Storage) setupRiver(ctx context.Context) (RiverDriver, func() error, error) {
	if err := ctx.Err(); err != nil {
		return nil, nil, fmt.Errorf("river setup canceled: %w", err)
	}

	switch s.DBType {
	case DBTypePostgres:
		return setupRiverPostgres(ctx, s.connectionString)
	case DBTypeSQLite:
		return s.setupRiverSQLite(ctx)
	default:
		return nil, nil, fmt.Errorf("unsupported database type: %s", s.DBType)
	}
}

// setupRiverPostgres initializes River for PostgreSQL
func setupRiverPostgres(ctx context.Context, connectionString string) (RiverDriver, func() error, error) {
	config, err := pgxpool.ParseConfig(connectionString)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to parse postgres connection: %w", err)
	}

	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to create postgres pool: %w", err)
	}

	riverDriver := riverpgxv5.New(pool)
	typedDriver := NewPostgresRiverDriver(riverDriver)

	// River migrations will be handled by the application if needed
	// For now, we'll let River handle its own schema setup

	return typedDriver, func() error {
		pool.Close()
		return nil
	}, nil
}

// initializePostgresClient initializes a River client for PostgreSQL
func (s *Storage) initializePostgresClient(ctx context.Context, config *river.Config) error {
	pgDriverWrapper, ok := s.RiverDriver.(*PostgresRiverDriver)
	if !ok {
		return fmt.Errorf("expected postgres river driver wrapper")
	}

	pgDriver := pgDriverWrapper.TypedDriver()

	client, err := river.NewClient(pgDriver, config)
	if err != nil {
		return fmt.Errorf("failed to create postgres river client: %w", err)
	}

	// Enqueue client available immediately; working loops start async — the HTTP
	// server must not block on background-job readiness. (Same rationale as the
	// SQLite path; matters less on Postgres but keeps startup uniform.)
	queue := NewPostgresQueueClient(client)
	queue.startup = newQueueStartup(ctx)
	s.River = queue
	go func() {
		if err := queue.Start(ctx); err != nil {
			slog.Error("river: postgres client start failed; background jobs will not run until restart", "error", err)
		}
	}()
	return nil
}

// initializeSQLiteClient initializes a River client for SQLite
func (s *Storage) initializeSQLiteClient(ctx context.Context, config *river.Config) error {
	sqliteDriverWrapper, ok := s.RiverDriver.(*SQLiteRiverDriver)
	if !ok {
		return fmt.Errorf("expected sqlite river driver wrapper")
	}

	sqliteDriver := sqliteDriverWrapper.TypedDriver()

	client, err := river.NewClient(sqliteDriver, config)
	if err != nil {
		return fmt.Errorf("failed to create sqlite river client: %w", err)
	}

	// Expose the queue immediately, but gate inserts until producer setup ends:
	// River's insert path can wake a producer even though its DB is already ready.
	queue := NewSQLiteQueueClient(client)
	queue.startup = newQueueStartup(ctx)
	s.River = queue
	// Start the working loops (fetch/execute + leader election) ASYNCHRONOUSLY.
	// client.Start blocks until it can elect a leader; under SQLite write
	// contention (e.g. a busy build resume) that can take many seconds — which
	// must NOT block app startup / the HTTP server (ark.Application.Start serves
	// after this returns). The HTTP listener + /api/health come up immediately;
	// background jobs begin once the loops are up.
	go func() {
		if err := queue.Start(ctx); err != nil {
			slog.Error("river: sqlite client start failed; background jobs will not run until restart", "error", err)
		}
	}()
	return nil
}
