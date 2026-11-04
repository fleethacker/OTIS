package seed

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
)

func quoteIdentifier(name string) string {
	return `"` + strings.ReplaceAll(name, `"`, `""`) + `"`
}

// insertRecords atomically inserts JSON records into a table, matching keys to columns.
func insertRecords(ctx context.Context, db *sql.DB, tableName string, cols tableInfo, records []map[string]any) (seeded int, err error) {
	if len(records) == 0 {
		return 0, nil
	}

	conn, err := beginSeedWrite(ctx, db)
	if err != nil {
		return 0, fmt.Errorf("begin seed transaction for %s: %w", tableName, err)
	}
	committed := false
	defer func() { err = finishSeedWrite(ctx, conn, committed, err) }()

	var populated bool
	if err := conn.QueryRowContext(ctx, "SELECT EXISTS (SELECT 1 FROM "+quoteIdentifier(tableName)+" LIMIT 1)").Scan(&populated); err != nil {
		return 0, fmt.Errorf("check seed table %s: %w", tableName, err)
	}
	if populated {
		return 0, nil
	}
	if err := convertSeedRecords(tableName, cols, records); err != nil {
		return 0, err
	}

	inserted := 0
	for _, record := range records {
		if err := seedContextError(ctx); err != nil {
			return 0, err
		}
		// Match JSON keys to table columns (case-insensitive).
		var colNames []string
		var placeholders []string
		var values []any

		for jsonKey, value := range record {
			column, ok := cols[strings.ToLower(jsonKey)]
			if !ok {
				continue // Skip JSON fields that don't match a column.
			}

			colNames = append(colNames, quoteIdentifier(column.name))
			placeholders = append(placeholders, "?")
			values = append(values, value)
		}

		if len(colNames) == 0 {
			continue
		}

		// #nosec G201 -- Schema-derived identifiers are quoted; record values use bound placeholders.
		query := fmt.Sprintf("INSERT INTO %s (%s) VALUES (%s)",
			quoteIdentifier(tableName),
			strings.Join(colNames, ", "),
			strings.Join(placeholders, ", "),
		)

		if _, err := conn.ExecContext(ctx, query, values...); err != nil {
			return 0, fmt.Errorf("insert into %s: %w", tableName, err)
		}

		inserted++
	}

	if _, err := conn.ExecContext(ctx, "COMMIT"); err != nil {
		return 0, fmt.Errorf("commit seed transaction for %s: %w", tableName, err)
	}

	committed = true
	return inserted, nil
}
