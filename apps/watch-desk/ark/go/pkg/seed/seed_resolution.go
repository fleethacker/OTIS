package seed

import (
	"context"
	"database/sql"
	"errors"
	"log/slog"
	"maps"
	"slices"
	"strings"
)

// matchTable finds the best table match for a JSON entity name.
// Tries: exact match, plural, singular, and case-insensitive variants.
func matchTable(entityName string, tables map[string]tableInfo) string {
	lower := strings.ToLower(entityName)

	// A flat array has no table identity. Only a sole user table is unambiguous.
	if entityName == "_default" {
		if len(tables) == 1 {
			for name := range tables {
				return name
			}
		}

		return ""
	}

	if _, ok := tables[lower]; ok {
		return lower
	}
	if _, ok := tables[lower+"s"]; ok {
		return lower + "s"
	}
	if _, ok := tables[lower+"es"]; ok {
		return lower + "es"
	}
	if strings.HasSuffix(lower, "s") {
		singular := lower[:len(lower)-1]
		if _, ok := tables[singular]; ok {
			return singular
		}
	}

	return ""
}

// seedEntry pairs a resolved table name with all its JSON records.
type seedEntry struct {
	table   string
	records []map[string]any
}

// resolveAndOrder combines aliases before ordering parent tables ahead of children.
// Every batch for a table participates in the same atomic insert and retry.
func resolveAndOrder(ctx context.Context, db *sql.DB, entities map[string][]map[string]any, tables map[string]tableInfo, logger *slog.Logger) ([]seedEntry, error) {
	if len(entities["_default"]) > 0 && len(tables) > 1 {
		return nil, errors.New("flat seed records match multiple tables; use a keyed JSON object with explicit table names")
	}

	byTable := make(map[string][]map[string]any, len(entities))
	// Stable alias order also makes generated row IDs independent of map order.
	for _, entityName := range slices.Sorted(maps.Keys(entities)) {
		tableName := matchTable(entityName, tables)
		if tableName == "" {
			logger.Debug("No matching table for seed entity", "entity", entityName)

			continue
		}
		byTable[tableName] = append(byTable[tableName], entities[entityName]...)
	}

	entries := make([]seedEntry, 0, len(byTable))
	resolved := make(map[string]bool, len(byTable))
	for _, tableName := range slices.Sorted(maps.Keys(byTable)) {
		resolved[tableName] = true
		entries = append(entries, seedEntry{table: tableName, records: byTable[tableName]})
	}
	deps := discoverFKDeps(ctx, db, resolved, logger)

	return topoSort(entries, deps), nil
}
