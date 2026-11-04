package storage

import (
	"context"
	"database/sql/driver"
	"errors"
	"fmt"
)

// Prepare implements the legacy driver.Conn statement entry point.
func (c *sqliteConn) Prepare(query string) (driver.Stmt, error) {
	return c.PrepareContext(context.Background(), query)
}

// PrepareContext preserves the registered driver's context-aware preparation.
func (c *sqliteConn) PrepareContext(ctx context.Context, query string) (driver.Stmt, error) {
	prepare, ok := c.Conn.(driver.ConnPrepareContext)
	if !ok {
		return nil, fmt.Errorf("SQLite driver lacks context-aware preparation")
	}
	stmt, err := prepare.PrepareContext(ctx, query)
	if err != nil {
		return nil, sqliteFailure("prepare statement", err)
	}
	return &sqliteStmt{Stmt: stmt, conn: c}, nil
}

type sqliteStmt struct {
	driver.Stmt
	conn *sqliteConn
}

// ExecContext admits a prepared operation without replaying its SQL.
func (s *sqliteStmt) ExecContext(ctx context.Context, args []driver.NamedValue) (driver.Result, error) {
	executor, ok := s.Stmt.(driver.StmtExecContext)
	if !ok {
		return nil, fmt.Errorf("SQLite statement lacks context-aware execution")
	}
	return s.conn.autoExec(ctx, func() (driver.Result, error) {
		result, err := executor.ExecContext(ctx, args)
		return result, sqliteFailure("execute statement", errors.Join(ctx.Err(), err))
	})
}

// QueryContext holds admission until prepared results close.
func (s *sqliteStmt) QueryContext(ctx context.Context, args []driver.NamedValue) (driver.Rows, error) {
	executor, ok := s.Stmt.(driver.StmtQueryContext)
	if !ok {
		return nil, fmt.Errorf("SQLite statement lacks context-aware queries")
	}
	return s.conn.autoQuery(ctx, func() (driver.Rows, error) {
		rows, err := executor.QueryContext(ctx, args)
		return rows, sqliteFailure("query statement", err)
	})
}

// Exec implements the legacy prepared-statement entry point.
func (s *sqliteStmt) Exec(values []driver.Value) (driver.Result, error) {
	return s.ExecContext(context.Background(), sqliteNamedValues(values))
}

// Query implements the legacy prepared-statement entry point.
func (s *sqliteStmt) Query(values []driver.Value) (driver.Rows, error) {
	return s.QueryContext(context.Background(), sqliteNamedValues(values))
}

// CheckNamedValue preserves the registered driver's parameter conversion.
func (s *sqliteStmt) CheckNamedValue(value *driver.NamedValue) error {
	if checker, ok := s.Stmt.(driver.NamedValueChecker); ok {
		err := checker.CheckNamedValue(value)
		if errors.Is(err, driver.ErrSkip) {
			return driver.ErrSkip
		}
		return sqliteFailure("check statement argument", err)
	}
	return s.conn.CheckNamedValue(value)
}

func sqliteNamedValues(values []driver.Value) []driver.NamedValue {
	args := make([]driver.NamedValue, len(values))
	for index, value := range values {
		args[index] = driver.NamedValue{Ordinal: index + 1, Value: value}
	}
	return args
}
