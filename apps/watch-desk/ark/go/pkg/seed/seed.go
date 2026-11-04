// Package seed provides automatic database seeding from JSON files.
// It reads seed_data.json, inspects the SQLite schema for table/column names,
// and inserts records via raw SQL — no hand-written Go seed code needed.
package seed

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"strings"

	// Pure-Go SQLite driver (no CGO, registers as "sqlite").
	_ "github.com/glebarez/go-sqlite"
)

// AutoSeed reads a JSON file and inserts its records into the SQLite database.
// It inspects the database schema to match JSON field names to table columns.
//
// JSON format (either works):
//
//	Keyed:  {"users": [{...}, {...}], "repos": [{...}]}
//	Flat:   [{...}, {...}]  — requires exactly one user-defined table
//
// Skips tables that already have data (idempotent). If the JSON file doesn't
// exist, does nothing (not an error). Each empty table is seeded atomically;
// a failed insert rolls back that table so a corrected fixture can be retried.
func AutoSeed(dsn string, jsonPath string, logger *slog.Logger) {
	if err := AutoSeedContext(context.Background(), dsn, jsonPath, logger); err != nil {
		logger.Warn("Database seeding canceled", "error", err)
	}
}

// AutoSeedContext seeds within the caller's lifetime. Fixture errors remain
// best-effort warnings; cancellation is returned so startup can stop promptly.
func AutoSeedContext(ctx context.Context, dsn string, jsonPath string, logger *slog.Logger) error {
	if err := seedContextError(ctx); err != nil {
		return err
	}
	data, err := os.ReadFile(jsonPath) // #nosec G304 -- The seed path comes from application startup configuration, not request input.
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			logger.Debug("No seed data file found, skipping", "path", jsonPath)

			return seedContextError(ctx)
		}

		logger.Warn("Could not read seed data file", "path", jsonPath, "error", err)

		return seedContextError(ctx)
	}

	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		logger.Warn("Could not open database for seeding", "error", err)

		return seedContextError(ctx)
	}
	defer func() { _ = db.Close() }()

	// Parse JSON into keyed format.
	entities, err := parseJSON(data)
	if err != nil {
		logger.Warn("Could not parse seed data", "error", err)

		return seedContextError(ctx)
	}

	// Get available tables and their columns from the database schema.
	tables, err := discoverSchema(ctx, db)
	if err != nil {
		logger.Warn("Could not read database schema", "error", err)

		return seedContextError(ctx)
	}

	// Resolve JSON entity names to actual table names.
	tableOrder, err := resolveAndOrder(ctx, db, entities, tables, logger)
	if err != nil {
		logger.Warn("Could not resolve seed tables", "error", err)

		return seedContextError(ctx)
	}

	seeded := 0
	for _, entry := range tableOrder {
		if err := seedContextError(ctx); err != nil {
			return err
		}
		inserted, err := insertRecords(ctx, db, entry.table, tables[entry.table], entry.records)
		if err != nil {
			logger.Warn("Error seeding table", "table", entry.table, "error", err)

			continue
		}

		if inserted == 0 {
			logger.Debug("Table already populated or fixture empty, skipping", "table", entry.table)
			continue
		}

		seeded += inserted
		logger.Info("Seeded table", "table", entry.table, "records", inserted)
	}

	if seeded > 0 {
		logger.Info("Database seeding complete", "total_records", seeded)
	}
	return seedContextError(ctx)
}

func seedContextError(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return fmt.Errorf("database seeding canceled: %w", err)
	}
	return nil
}

// tableInfo maps lowercase column names to their SQLite schema metadata.
type tableInfo map[string]columnInfo

type columnInfo struct {
	name     string
	dataType string
	nullable bool
}

// discoverSchema reads all user tables and their columns from SQLite.
// Skips internal tables (sqlite_*, settings — the framework bootstrap table).
func discoverSchema(ctx context.Context, db *sql.DB) (map[string]tableInfo, error) {
	rows, err := db.QueryContext(ctx, "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	tables := make(map[string]tableInfo)
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			continue
		}

		// Skip framework internal tables.
		if name == "settings" {
			continue
		}

		cols, err := discoverColumns(ctx, db, name)
		if err != nil {
			continue
		}

		tables[name] = cols
	}

	return tables, rows.Err()
}

// discoverColumns reads column names and declared types for a table.
func discoverColumns(ctx context.Context, db *sql.DB, tableName string) (tableInfo, error) {
	rows, err := db.QueryContext(ctx, "PRAGMA table_info("+quoteIdentifier(tableName)+")")
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	info := make(tableInfo)
	for rows.Next() {
		var cid int
		var name, colType string
		var notNull int
		var dflt sql.NullString
		var pk int
		if err := rows.Scan(&cid, &name, &colType, &notNull, &dflt, &pk); err != nil {
			continue
		}

		// Include every column, primary keys included. A fixture that
		// supplies an explicit "id" gets it inserted verbatim — SQLite
		// accepts explicit values for AUTOINCREMENT/rowid PKs and just
		// advances the sequence past them — so fixtures can use stable,
		// human-chosen ids that foreign keys reference. A fixture that
		// OMITS the id leaves the column out of its INSERT, so
		// autoincrement assigns one as before. (The old code skipped PK
		// columns outright, which made explicit ids silently vanish and
		// forced FK references to guess insertion order — a footgun every
		// build rediscovered.)
		info[strings.ToLower(name)] = columnInfo{name: name, dataType: colType, nullable: notNull == 0 && pk == 0}
	}

	return info, rows.Err()
}

// discoverFKDeps reads PRAGMA foreign_key_list for each table and returns
// a map of tableName -> list of parent table names it references.
func discoverFKDeps(ctx context.Context, db *sql.DB, tables map[string]bool, logger *slog.Logger) map[string][]string {
	deps := make(map[string][]string)

	for table := range tables {
		rows, err := db.QueryContext(ctx, "PRAGMA foreign_key_list("+quoteIdentifier(table)+")")
		if err != nil {
			continue
		}

		for rows.Next() {
			var id, seq int
			var refTable, from, to, onUpdate, onDelete, match string
			if err := rows.Scan(&id, &seq, &refTable, &from, &to, &onUpdate, &onDelete, &match); err != nil {
				continue
			}

			// Only track deps on tables we're actually seeding.
			if tables[refTable] && refTable != table {
				deps[table] = append(deps[table], refTable)
			}
		}

		if err := rows.Err(); err != nil {
			logger.Warn("Could not read seed foreign keys", "table", table, "error", err)
			delete(deps, table)
		}
		_ = rows.Close()
	}

	return deps
}

// topoSort orders entries so that tables with no FK deps come first,
// and tables that reference other tables come after their parents.
// Falls back to original order for cycles (shouldn't happen with valid schemas).
func topoSort(entries []seedEntry, deps map[string][]string) []seedEntry {
	if len(entries) <= 1 {
		return entries
	}

	// Build lookup and in-degree count.
	byName := make(map[string]seedEntry, len(entries))
	inDegree := make(map[string]int, len(entries))

	for _, e := range entries {
		byName[e.table] = e
		inDegree[e.table] = 0
	}

	for child, parents := range deps {
		if _, ok := byName[child]; !ok {
			continue
		}

		for _, parent := range parents {
			if _, ok := byName[parent]; ok {
				inDegree[child]++
			}
		}
	}

	// Kahn's algorithm.
	var queue []string

	for _, e := range entries {
		if inDegree[e.table] == 0 {
			queue = append(queue, e.table)
		}
	}

	var sorted []seedEntry

	for len(queue) > 0 {
		curr := queue[0]
		queue = queue[1:]
		sorted = append(sorted, byName[curr])

		// Find children that depend on curr and decrement their in-degree.
		for child, parents := range deps {
			for _, p := range parents {
				if p == curr {
					inDegree[child]--

					if inDegree[child] == 0 {
						queue = append(queue, child)
					}
				}
			}
		}
	}

	// If cycle detected (sorted < entries), append remaining in original order.
	if len(sorted) < len(entries) {
		seen := make(map[string]bool, len(sorted))
		for _, e := range sorted {
			seen[e.table] = true
		}

		for _, e := range entries {
			if !seen[e.table] {
				sorted = append(sorted, e)
			}
		}
	}

	return sorted
}
