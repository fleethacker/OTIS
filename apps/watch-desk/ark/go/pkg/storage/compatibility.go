package storage

import (
	"database/sql"

	"github.com/jackc/pgx/v5"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/riverdriver"
)

// RiverDriver preserves the historical driver interface for application callers.
// Concrete drivers expose Driver and TypedDriver for new code.
type RiverDriver interface {
	// GetExecutor returns the underlying driver, not an executor.
	//
	// Compatibility entry point. New code should use the concrete driver's Driver or TypedDriver method.
	GetExecutor() any
}

// GetRiverClient returns the underlying River client.
//
// Compatibility entry point. New code should use RiverClient.
func (q *PostgresQueueClient) GetRiverClient() *river.Client[pgx.Tx] { return q.RiverClient() }

// GetRiverClient returns the underlying River client.
//
// Compatibility entry point. New code should use RiverClient.
func (q *SQLiteQueueClient) GetRiverClient() *river.Client[*sql.Tx] { return q.RiverClient() }

// GetExecutor returns the underlying driver.
//
// Compatibility entry point. New code should use Driver.
func (d *PostgresRiverDriver) GetExecutor() any { return d.Driver() }

// GetExecutor returns the underlying driver.
//
// Compatibility entry point. New code should use Driver.
func (d *SQLiteRiverDriver) GetExecutor() any { return d.Driver() }

// GetTypedDriver returns the underlying typed driver.
//
// Compatibility entry point. New code should use TypedDriver.
func (d *PostgresRiverDriver) GetTypedDriver() riverdriver.Driver[pgx.Tx] { return d.TypedDriver() }

// GetTypedDriver returns the underlying typed driver.
//
// Compatibility entry point. New code should use TypedDriver.
func (d *SQLiteRiverDriver) GetTypedDriver() riverdriver.Driver[*sql.Tx] { return d.TypedDriver() }
