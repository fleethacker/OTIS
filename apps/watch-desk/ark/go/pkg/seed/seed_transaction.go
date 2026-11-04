package seed

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"time"
)

// Reserve the writer explicitly on one connection. The SQLite driver skips
// _txlock when _time_format is configured, so DSN options cannot guarantee it.
func beginSeedWrite(ctx context.Context, db *sql.DB) (*sql.Conn, error) {
	conn, err := db.Conn(ctx)
	if err != nil {
		return nil, fmt.Errorf("acquire seed connection: %w", err)
	}
	if _, err := conn.ExecContext(ctx, "BEGIN IMMEDIATE"); err != nil {
		return nil, fmt.Errorf("reserve seed writer: %w", errors.Join(err, conn.Close()))
	}
	return conn, nil
}

func finishSeedWrite(ctx context.Context, conn *sql.Conn, committed bool, original error) error {
	if !committed {
		cleanupCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer cancel()
		if _, err := conn.ExecContext(cleanupCtx, "ROLLBACK"); err != nil {
			original = errors.Join(original, fmt.Errorf("rollback seed transaction: %w", err))
			// A connection with an unfinished transaction must never reenter the pool.
			if err := conn.Raw(func(any) error { return driver.ErrBadConn }); err != nil && !errors.Is(err, driver.ErrBadConn) {
				original = errors.Join(original, fmt.Errorf("discard seed connection: %w", err))
			}
		}
	}
	if err := conn.Close(); err != nil && !errors.Is(err, sql.ErrConnDone) {
		original = errors.Join(original, fmt.Errorf("close seed connection: %w", err))
	}
	if original != nil {
		return fmt.Errorf("complete seed transaction: %w", original)
	}
	return nil
}
