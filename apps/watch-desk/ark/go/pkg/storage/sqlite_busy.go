package storage

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"time"
)

const sqliteLockBudget = 5 * time.Second

// openSQLiteDB is River's private execution pool. Its commands always have an
// explicit transaction; application schema PRAGMAs and other general-purpose
// SQL must continue to use the unwrapped application pool.
func openSQLiteDB(dsn string) (*sql.DB, error) {
	registered, err := sql.Open(DBTypeSQLite, dsn)
	if err != nil {
		return nil, fmt.Errorf("resolve SQLite driver: %w", err)
	}
	base := registered.Driver()
	if err := registered.Close(); err != nil {
		return nil, fmt.Errorf("close unopened SQLite driver pool: %w", err)
	}
	return sql.OpenDB(sqliteConnector{base: base, dsn: dsn}), nil
}

type sqliteConnector struct {
	base driver.Driver
	dsn  string
}

// Driver implements driver.Connector.
func (c sqliteConnector) Driver() driver.Driver { return sqliteDriver{base: c.base} }

// Connect initializes one context-bound River connection.
func (c sqliteConnector) Connect(ctx context.Context) (driver.Conn, error) {
	if err := ctx.Err(); err != nil {
		return nil, sqliteFailure("connect", err)
	}
	dsn, pragmas, err := sqliteInitializationDSN(c.dsn)
	if err != nil {
		return nil, err
	}
	base, err := c.base.Open(dsn)
	if err != nil {
		return nil, sqliteFailure("open connection", err)
	}
	conn := &sqliteConn{Conn: base}
	err = conn.configure(ctx, pragmas)
	if err != nil {
		return nil, sqliteFailure("configure connection", errors.Join(err, base.Close()))
	}
	return conn, nil
}

type sqliteDriver struct{ base driver.Driver }

// Open implements driver.Driver.
func (d sqliteDriver) Open(dsn string) (driver.Conn, error) {
	return (sqliteConnector{base: d.base, dsn: dsn}).Connect(context.Background())
}

type sqliteConn struct {
	driver.Conn
	active      *sqliteTx
	busyTimeout int64
	broken      bool
}

// IsValid retires connections whose native transaction could not be cleaned up.
func (c *sqliteConn) IsValid() bool {
	if validator, ok := c.Conn.(driver.Validator); ok && !validator.IsValid() {
		return false
	}
	return !c.broken
}

// ResetSession rejects a poisoned connection before another operation starts.
func (c *sqliteConn) ResetSession(ctx context.Context) error {
	if c.broken || c.active != nil {
		return driver.ErrBadConn // No operation was admitted on this checkout.
	}
	if reset, ok := c.Conn.(driver.SessionResetter); ok {
		return sqliteFailure("reset session", reset.ResetSession(ctx))
	}
	return sqliteFailure("reset session", ctx.Err())
}

// Ping preserves the underlying driver's liveness check.
func (c *sqliteConn) Ping(ctx context.Context) error {
	if ping, ok := c.Conn.(driver.Pinger); ok {
		return sqliteFailure("ping", ping.Ping(ctx))
	}
	return sqliteFailure("ping", ctx.Err())
}

// CheckNamedValue preserves the registered driver's parameter conversion.
func (c *sqliteConn) CheckNamedValue(value *driver.NamedValue) error {
	if checker, ok := c.Conn.(driver.NamedValueChecker); ok {
		err := checker.CheckNamedValue(value)
		if errors.Is(err, driver.ErrSkip) {
			return driver.ErrSkip
		}
		return sqliteFailure("check argument", err)
	}
	return driver.ErrSkip
}

func (c *sqliteConn) exec(ctx context.Context, query string, args []driver.NamedValue) (driver.Result, error) {
	executor, ok := c.Conn.(driver.ExecerContext)
	if !ok {
		return nil, fmt.Errorf("SQLite driver lacks context-aware execution")
	}
	result, err := executor.ExecContext(ctx, query, args)
	return result, sqliteFailure("execute", errors.Join(ctx.Err(), err))
}

func (c *sqliteConn) query(ctx context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	executor, ok := c.Conn.(driver.QueryerContext)
	if !ok {
		return nil, fmt.Errorf("SQLite driver lacks context-aware queries")
	}
	rows, err := executor.QueryContext(ctx, query, args)
	return rows, sqliteFailure("query", err)
}

// SQLite guarantees that a failed native BEGIN has admitted no write and
// that a BUSY COMMIT leaves the transaction active. Retry only those boundaries,
// never a statement, completed write, or stale-snapshot transaction.
// The registered driver's Tx primitives execute sqlite3_exec directly. Unlike
// ExecContext, they cannot skip SQL and report success on cancellation or enter
// the driver's uninterruptible shared-cache unlock-notify wait.
func (c *sqliteConn) lock(callerCtx context.Context, boundary func() error) (returnErr error) {
	ctx, cancel := context.WithTimeout(callerCtx, sqliteLockBudget)
	defer cancel()
	nativeWait := min(c.busyTimeout, int64(20))
	if _, err := c.exec(context.Background(), fmt.Sprintf("PRAGMA busy_timeout(%d)", nativeWait), nil); err != nil {
		return err
	}
	defer func() {
		if _, err := c.exec(context.Background(), fmt.Sprintf("PRAGMA busy_timeout(%d)", c.busyTimeout), nil); err != nil {
			c.broken = true
			returnErr = errors.Join(returnErr, fmt.Errorf("restore SQLite busy timeout: %w", err))
		}
	}()
	for {
		if err := sqliteLockContextError(callerCtx, ctx); err != nil {
			return sqliteFailure("lock admission", err)
		}
		err := boundary()
		if err == nil {
			return nil
		}
		if cause := sqliteLockContextError(callerCtx, ctx); cause != nil {
			return sqliteFailure("lock admission", errors.Join(cause, err))
		}
		var coded interface{ Code() int }
		if !errors.As(err, &coded) || (coded.Code() != 5 && coded.Code() != 262) {
			return err
		}
		timer := time.NewTimer(5 * time.Millisecond)
		select {
		case <-ctx.Done():
			timer.Stop()
			return sqliteFailure("lock admission", errors.Join(sqliteLockContextError(callerCtx, ctx), err))
		case <-timer.C:
		}
	}
}

// A caller's Done can close before cancellation reaches the derived budget.
// Preserve that cause on failed boundaries while successful native work keeps
// its acknowledged outcome, even when cancellation arrives concurrently.
func sqliteLockContextError(callerCtx, budgetCtx context.Context) error {
	if err := callerCtx.Err(); err != nil {
		return sqliteFailure("caller context", err)
	}
	return sqliteFailure("lock budget", budgetCtx.Err())
}

// Begin implements the legacy driver.Conn transaction entry point.
func (c *sqliteConn) Begin() (driver.Tx, error) {
	return c.BeginTx(context.Background(), driver.TxOptions{})
}

// BeginTx acquires writer ownership before any transaction statement runs.
func (c *sqliteConn) BeginTx(ctx context.Context, options driver.TxOptions) (driver.Tx, error) {
	if options.ReadOnly || (options.Isolation != 0 && options.Isolation != driver.IsolationLevel(sql.LevelSerializable)) {
		return nil, fmt.Errorf("river SQLite transactions require writable serializable isolation")
	}
	if c.active != nil {
		return nil, fmt.Errorf("SQLite transaction already active")
	}
	beginner, ok := c.Conn.(driver.ConnBeginTx)
	if !ok {
		return nil, fmt.Errorf("SQLite driver lacks native transaction admission")
	}
	var native driver.Tx
	if err := c.lock(ctx, func() error {
		var err error
		native, err = beginner.BeginTx(context.Background(), driver.TxOptions{})
		return sqliteFailure("begin", err)
	}); err != nil {
		return nil, err
	}
	tx := &sqliteTx{conn: c, native: native, ctx: ctx}
	c.active = tx
	return tx, nil
}

type sqliteTx struct {
	conn   *sqliteConn
	native driver.Tx
	ctx    context.Context
	done   bool
}

// Commit retries the native boundary before database/sql retires this transaction.
func (t *sqliteTx) Commit() error {
	if t.done {
		return sql.ErrTxDone
	}
	err := t.conn.lock(t.ctx, t.native.Commit)
	if err != nil {
		return sqliteFailure("commit", errors.Join(err, t.Rollback()))
	}
	t.done, t.conn.active = true, nil
	return nil
}

// Rollback cleans up native state or marks the connection for retirement.
func (t *sqliteTx) Rollback() error {
	if t.done {
		return nil
	}
	t.done, t.conn.active = true, nil
	err := t.native.Rollback()
	if err != nil {
		t.conn.broken = true
		return fmt.Errorf("rollback failed SQLite transaction: %w", err)
	}
	return nil
}

func (c *sqliteConn) autoExec(ctx context.Context, execute func() (driver.Result, error)) (driver.Result, error) {
	if c.active != nil {
		return execute()
	}
	tx, err := c.BeginTx(ctx, driver.TxOptions{})
	if err != nil {
		return nil, err
	}
	result, err := execute()
	if err != nil {
		return nil, sqliteFailure("execute transaction", errors.Join(err, tx.Rollback()))
	}
	return result, sqliteFailure("commit execution", tx.Commit())
}

func (c *sqliteConn) autoQuery(ctx context.Context, query func() (driver.Rows, error)) (driver.Rows, error) {
	if c.active != nil {
		return query()
	}
	tx, err := c.BeginTx(ctx, driver.TxOptions{})
	if err != nil {
		return nil, err
	}
	rows, err := query()
	if err != nil {
		return nil, sqliteFailure("query transaction", errors.Join(err, tx.Rollback()))
	}
	return &sqliteRows{Rows: rows, tx: tx, ctx: ctx}, nil
}

// ExecContext makes an autocommit operation one admitted transaction.
func (c *sqliteConn) ExecContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Result, error) {
	return c.autoExec(ctx, func() (driver.Result, error) { return c.exec(ctx, query, args) })
}

// QueryContext keeps writer ownership until the result has closed and committed.
func (c *sqliteConn) QueryContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	return c.autoQuery(ctx, func() (driver.Rows, error) { return c.query(ctx, query, args) })
}

func sqliteFailure(operation string, err error) error {
	if err == nil {
		return nil
	}
	return fmt.Errorf("SQLite %s: %w", operation, err)
}
