// Package storage provides type-safe database storage functionality for Ark applications
package storage

import (
	"context"
	"database/sql"

	"github.com/jackc/pgx/v5"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/riverdriver"
	"github.com/riverqueue/river/rivertype"
)

// QueueClient is the abstraction handler code uses to insert jobs and
// inspect the periodic schedule, regardless of whether River is backed
// by Postgres (`*river.Client[pgx.Tx]`) or SQLite (`*river.Client[*sql.Tx]`).
//
// Without this, every caller would have to type-switch on the underlying
// generic — which leaks the database choice into business logic. Pattern
// borrowed from uds-registry's storage layer (proven in production
// against both backends).
type QueueClient interface {
	Start(ctx context.Context) error
	Stop(ctx context.Context) error
	Insert(ctx context.Context, args river.JobArgs, opts *river.InsertOpts) (*rivertype.JobInsertResult, error)
	PeriodicJobs() *river.PeriodicJobBundle
}

// PostgresQueueClient wraps River client for PostgreSQL
type PostgresQueueClient struct {
	client  *river.Client[pgx.Tx]
	startup *queueStartup
}

// NewPostgresQueueClient creates a new PostgreSQL queue client wrapper
func NewPostgresQueueClient(client *river.Client[pgx.Tx]) *PostgresQueueClient {
	return &PostgresQueueClient{client: client}
}

// Start implements QueueClient interface
func (q *PostgresQueueClient) Start(ctx context.Context) error {
	if q.startup != nil {
		return q.startup.start(ctx, q.client.Start)
	}
	return q.client.Start(ctx)
}

// Stop implements QueueClient interface
func (q *PostgresQueueClient) Stop(ctx context.Context) error {
	return q.startup.stop(ctx, q.client.Stop, q.client.StopAndCancel)
}

// Insert implements QueueClient — enqueues one job through the
// underlying typed Postgres River client.
func (q *PostgresQueueClient) Insert(
	ctx context.Context,
	args river.JobArgs,
	opts *river.InsertOpts,
) (*rivertype.JobInsertResult, error) {
	if err := q.startup.wait(ctx); err != nil {
		return nil, err
	}
	return q.client.Insert(ctx, args, opts)
}

// PeriodicJobs implements QueueClient — returns the periodic-job
// bundle so callers can register cron-style work.
func (q *PostgresQueueClient) PeriodicJobs() *river.PeriodicJobBundle {
	return q.client.PeriodicJobs()
}

// RiverClient returns the underlying River client for type-safe operations
func (q *PostgresQueueClient) RiverClient() *river.Client[pgx.Tx] {
	return q.client
}

// SQLiteQueueClient wraps River client for SQLite
type SQLiteQueueClient struct {
	client  *river.Client[*sql.Tx]
	startup *queueStartup
}

// NewSQLiteQueueClient creates a new SQLite queue client wrapper
func NewSQLiteQueueClient(client *river.Client[*sql.Tx]) *SQLiteQueueClient {
	return &SQLiteQueueClient{client: client}
}

// Start implements QueueClient interface
func (q *SQLiteQueueClient) Start(ctx context.Context) error {
	if q.startup != nil {
		return q.startup.start(ctx, q.client.Start)
	}
	return q.client.Start(ctx)
}

// Stop implements QueueClient interface
func (q *SQLiteQueueClient) Stop(ctx context.Context) error {
	return q.startup.stop(ctx, q.client.Stop, q.client.StopAndCancel)
}

// Insert implements QueueClient — enqueues one job through the
// underlying typed SQLite River client.
func (q *SQLiteQueueClient) Insert(
	ctx context.Context,
	args river.JobArgs,
	opts *river.InsertOpts,
) (*rivertype.JobInsertResult, error) {
	if err := q.startup.wait(ctx); err != nil {
		return nil, err
	}
	return q.client.Insert(ctx, args, opts)
}

// PeriodicJobs implements QueueClient — returns the periodic-job
// bundle so callers can register cron-style work.
func (q *SQLiteQueueClient) PeriodicJobs() *river.PeriodicJobBundle {
	return q.client.PeriodicJobs()
}

// RiverClient returns the underlying River client for type-safe operations
func (q *SQLiteQueueClient) RiverClient() *river.Client[*sql.Tx] {
	return q.client
}

// PostgresRiverDriver wraps River driver for PostgreSQL
type PostgresRiverDriver struct {
	driver riverdriver.Driver[pgx.Tx]
}

// NewPostgresRiverDriver creates a new PostgreSQL River driver wrapper
func NewPostgresRiverDriver(driver riverdriver.Driver[pgx.Tx]) *PostgresRiverDriver {
	return &PostgresRiverDriver{driver: driver}
}

// Driver returns the underlying driver
func (d *PostgresRiverDriver) Driver() any {
	return d.driver
}

// TypedDriver returns the properly typed driver for PostgreSQL
func (d *PostgresRiverDriver) TypedDriver() riverdriver.Driver[pgx.Tx] {
	return d.driver
}

// SQLiteRiverDriver wraps River driver for SQLite
type SQLiteRiverDriver struct {
	driver riverdriver.Driver[*sql.Tx]
}

// NewSQLiteRiverDriver creates a new SQLite River driver wrapper
func NewSQLiteRiverDriver(driver riverdriver.Driver[*sql.Tx]) *SQLiteRiverDriver {
	return &SQLiteRiverDriver{driver: driver}
}

// Driver returns the underlying driver
func (d *SQLiteRiverDriver) Driver() any {
	return d.driver
}

// TypedDriver returns the properly typed driver for SQLite
func (d *SQLiteRiverDriver) TypedDriver() riverdriver.Driver[*sql.Tx] {
	return d.driver
}
