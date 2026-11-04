package storage

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	_ "github.com/glebarez/go-sqlite" // Pure-Go SQLite driver (no CGO, registers as "sqlite").
	"github.com/riverqueue/river/riverdriver/riversqlite"
	"github.com/riverqueue/river/rivermigrate"
)

// SQLiteDB returns the framework-managed application pool. A single connection
// serializes application operations. River owns a separate private pool with
// bounded writer admission and commit recovery.
// The configured DSN is preserved, with foreign-key enforcement enabled on
// every connection as required by ENT schema migrations.
//
// Storage owns the pool and closes it after River stops. Register the ENT
// client with SetEntClient for its additional lifecycle cleanup. Commit or roll
// back write transactions before inserting a job through another connection.
func (s *Storage) SQLiteDB() (*sql.DB, error) {
	if s.DBType != DBTypeSQLite {
		return nil, fmt.Errorf("SQLiteDB requires sqlite storage, got %s", s.DBType)
	}
	s.sqliteMu.Lock()
	defer s.sqliteMu.Unlock()
	if s.sqliteClosed {
		return nil, fmt.Errorf("sqlite storage is closed")
	}
	if s.sqliteDB != nil {
		return s.sqliteDB, nil
	}
	db, err := sql.Open(DBTypeSQLite, sqliteDSN(s.connectionString))
	if err != nil {
		return nil, fmt.Errorf("failed to open sqlite connection: %w", err)
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	s.sqliteDB = db

	return db, nil
}

func sqliteDSN(connectionString string) string {
	separator := "?"
	if strings.Contains(connectionString, "?") {
		separator = "&"
	}
	return connectionString + separator + "_pragma=foreign_keys(1)"
}

func (s *Storage) closeSQLiteDB() error {
	s.sqliteMu.Lock()
	defer s.sqliteMu.Unlock()
	s.sqliteClosed = true
	if s.sqliteDB == nil {
		return nil
	}
	// An ENT client's Close may already have closed this same pool.
	// database/sql.Close is idempotent and closes each physical connection once.
	if err := s.sqliteDB.Close(); err != nil {
		return fmt.Errorf("close SQLite pool: %w", err)
	}
	return nil
}

// setupRiverSQLite keeps River's transaction policy private. Existing generated
// application bootstraps retain their own ENT pools and require no source edit.
func (s *Storage) setupRiverSQLite(ctx context.Context) (RiverDriver, func() error, error) {
	db, err := openSQLiteDB(sqliteDSN(s.connectionString))
	if err != nil {
		return nil, nil, err
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	riverDriver := riversqlite.New(db)
	migrator, err := rivermigrate.New(riverDriver, nil)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to create river migrator: %w", errors.Join(err, db.Close()))
	}
	if _, err := migrator.Migrate(ctx, rivermigrate.DirectionUp, nil); err != nil {
		return nil, nil, fmt.Errorf("failed to run river migrations: %w", errors.Join(err, db.Close()))
	}

	return NewSQLiteRiverDriver(riverDriver), db.Close, nil
}
