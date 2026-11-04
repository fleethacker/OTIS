package storage

import (
	"context"
	"database/sql/driver"
	"errors"
	"fmt"
	"io"
	"net/url"
	"strings"
)

// Apply DSN PRAGMAs through the context-aware connection interface rather than
// glebarez.Open, which runs them with context.Background and a five-second wait.
// Their original order and values are retained. Configuration is never replayed.
func sqliteInitializationDSN(dsn string) (string, []string, error) {
	path, rawQuery, found := strings.Cut(dsn, "?")
	if !found {
		return dsn + "?_txlock=immediate", nil, nil
	}
	query, err := url.ParseQuery(rawQuery)
	if err != nil {
		return "", nil, fmt.Errorf("parse private SQLite connection options: %w", err)
	}
	pragmas := query["_pragma"]
	query.Del("_pragma")
	// The pinned driver returns early for _time_format and ignores _txlock.
	// Its only supported format, sqlite, is also its default. Remove that
	// redundant option without changing timestamp encoding or bypassing errors.
	if format := query.Get("_time_format"); format != "" && format != "sqlite" {
		return "", nil, fmt.Errorf("unknown SQLite _time_format %q", format)
	}
	query.Del("_time_format")
	if mode := strings.ToLower(query.Get("_txlock")); mode != "" && mode != "deferred" && mode != "immediate" && mode != "exclusive" {
		return "", nil, fmt.Errorf("unknown SQLite _txlock %q", mode)
	}
	// Only River's pool changes transaction admission. Shared-cache table
	// readers can otherwise block a statement in the driver's uncancelable
	// unlock-notify loop after BEGIN IMMEDIATE. EXCLUSIVE admission reserves
	// those locks before any SQL runs, including for shared in-memory databases.
	mode := "immediate"
	if query.Get("cache") == "shared" {
		mode = "exclusive"
	}
	query.Set("_txlock", mode)
	return path + "?" + query.Encode(), pragmas, nil
}

func (c *sqliteConn) configure(ctx context.Context, pragmas []string) error {
	timeout, err := c.readBusyTimeout(ctx)
	if err != nil {
		return err
	}
	for _, pragma := range pragmas {
		if err := ctx.Err(); err != nil {
			return sqliteFailure("initialize connection", err)
		}
		if _, err := c.exec(ctx, "PRAGMA busy_timeout(20)", nil); err != nil {
			return err
		}
		configured, err := c.configurePragma(ctx, pragma)
		if err != nil {
			return err
		}
		if configured != nil {
			timeout = *configured
		}
	}
	c.busyTimeout = timeout
	_, err = c.exec(ctx, fmt.Sprintf("PRAGMA busy_timeout(%d)", timeout), nil)
	return err
}

func (c *sqliteConn) configurePragma(ctx context.Context, pragma string) (_ *int64, returnErr error) {
	rows, err := c.query(ctx, "PRAGMA "+pragma, nil)
	if err != nil {
		return nil, err
	}
	defer func() { returnErr = sqliteFailure("close connection options", errors.Join(returnErr, rows.Close())) }()
	columns := rows.Columns()
	var timeout *int64
	for {
		if err := ctx.Err(); err != nil {
			return nil, sqliteFailure("initialize connection option", err)
		}
		values := make([]driver.Value, len(columns))
		err := rows.Next(values)
		if errors.Is(err, io.EOF) {
			return timeout, nil
		}
		if err != nil {
			return nil, sqliteFailure("initialize connection option", err)
		}
		// SQLite names this result column independently of identifier quoting or
		// schema qualification. Observe its actual value instead of parsing SQL.
		if len(columns) == 1 && columns[0] == "timeout" {
			value, ok := values[0].(int64)
			if !ok || value < 0 {
				return nil, fmt.Errorf("SQLite returned invalid configured busy timeout")
			}
			timeout = &value
		}
	}
}

func (c *sqliteConn) readBusyTimeout(ctx context.Context) (int64, error) {
	rows, err := c.query(ctx, "PRAGMA busy_timeout", nil)
	if err != nil {
		return 0, err
	}
	values := make([]driver.Value, 1)
	err = rows.Next(values)
	closeErr := rows.Close()
	if err != nil || closeErr != nil {
		return 0, sqliteFailure("read busy timeout", errors.Join(err, closeErr))
	}
	timeout, ok := values[0].(int64)
	if !ok || timeout < 0 {
		return 0, fmt.Errorf("SQLite returned invalid busy timeout")
	}
	return timeout, nil
}
