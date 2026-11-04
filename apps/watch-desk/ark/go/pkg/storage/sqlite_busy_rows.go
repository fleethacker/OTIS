package storage

import (
	"context"
	"database/sql/driver"
	"errors"
	"io"
	"reflect"
)

type sqliteRows struct {
	driver.Rows
	tx     driver.Tx
	ctx    context.Context
	failed error
	closed bool
	result error
}

// Next preserves the original result stream without replaying its query.
func (r *sqliteRows) Next(values []driver.Value) error {
	if err := r.ctx.Err(); err != nil {
		r.failed = err
		return sqliteFailure("read rows", errors.Join(err, r.Close()))
	}
	err := r.Rows.Next(values)
	if err != nil && !errors.Is(err, io.EOF) {
		r.failed = err
		return sqliteFailure("read rows", errors.Join(err, r.Close()))
	}
	if errors.Is(err, io.EOF) {
		if !r.HasNextResultSet() {
			if closeErr := r.Close(); closeErr != nil {
				return closeErr
			}
		}
		return io.EOF // database/sql expects the exact iterator sentinel.
	}
	return sqliteFailure("read rows", err)
}

// Close finalizes once, then commits or rolls back the original transaction.
func (r *sqliteRows) Close() error {
	if r.closed {
		return r.result
	}
	r.closed = true
	err := errors.Join(r.failed, r.Rows.Close(), r.ctx.Err())
	if err != nil {
		r.result = errors.Join(err, r.tx.Rollback())
	} else {
		r.result = r.tx.Commit()
	}
	return r.result
}

// ColumnTypeDatabaseTypeName preserves optional result metadata.
func (r *sqliteRows) ColumnTypeDatabaseTypeName(index int) string {
	if rows, ok := r.Rows.(driver.RowsColumnTypeDatabaseTypeName); ok {
		return rows.ColumnTypeDatabaseTypeName(index)
	}
	return ""
}

// ColumnTypeScanType preserves optional result metadata.
func (r *sqliteRows) ColumnTypeScanType(index int) reflect.Type {
	if rows, ok := r.Rows.(driver.RowsColumnTypeScanType); ok {
		return rows.ColumnTypeScanType(index)
	}
	return reflect.TypeFor[any]()
}

// ColumnTypeLength preserves optional result metadata.
func (r *sqliteRows) ColumnTypeLength(index int) (int64, bool) {
	if rows, ok := r.Rows.(driver.RowsColumnTypeLength); ok {
		return rows.ColumnTypeLength(index)
	}
	return 0, false
}

// ColumnTypeNullable preserves optional result metadata.
func (r *sqliteRows) ColumnTypeNullable(index int) (bool, bool) {
	if rows, ok := r.Rows.(driver.RowsColumnTypeNullable); ok {
		return rows.ColumnTypeNullable(index)
	}
	return false, false
}

// ColumnTypePrecisionScale preserves optional result metadata.
func (r *sqliteRows) ColumnTypePrecisionScale(index int) (int64, int64, bool) {
	if rows, ok := r.Rows.(driver.RowsColumnTypePrecisionScale); ok {
		return rows.ColumnTypePrecisionScale(index)
	}
	return 0, 0, false
}

// HasNextResultSet preserves optional multiple-result behavior.
func (r *sqliteRows) HasNextResultSet() bool {
	rows, ok := r.Rows.(driver.RowsNextResultSet)
	return ok && rows.HasNextResultSet()
}

// NextResultSet keeps the transaction until the final result set closes.
func (r *sqliteRows) NextResultSet() error {
	rows, ok := r.Rows.(driver.RowsNextResultSet)
	if !ok {
		return io.EOF
	}
	if err := r.ctx.Err(); err != nil {
		r.failed = err
		return sqliteFailure("advance result", errors.Join(err, r.Close()))
	}
	err := rows.NextResultSet()
	if err == nil {
		return nil
	}
	if !errors.Is(err, io.EOF) {
		r.failed = err
	}
	if closeErr := r.Close(); closeErr != nil {
		return closeErr
	}
	if errors.Is(err, io.EOF) {
		return io.EOF
	}
	return sqliteFailure("advance result", err)
}
