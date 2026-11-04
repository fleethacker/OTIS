package ark

import (
	"context"
	"database/sql"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// ConfigureSQLiteDatabase configures one SQLite database for domain data and jobs.
// applicationRoot must be absolute. An explicit ARK_DB_PATH selects an isolated
// database; otherwise existing legacy data is retained and populated split
// databases require offline reconciliation before startup can mutate either file.
func ConfigureSQLiteDatabase(applicationRoot string) (string, error) {
	if !filepath.IsAbs(applicationRoot) {
		return "", fmt.Errorf("SQLite application root must be absolute: %q", applicationRoot)
	}
	dsn, err := resolveSQLiteDatabaseDSN(applicationRoot, os.Getenv("ARK_DB_PATH"), os.Getenv("DATABASE_URL"))
	if err != nil {
		return "", err
	}
	databaseURL, err := url.Parse(dsn)
	if err != nil {
		return "", fmt.Errorf("parse configured SQLite database URL: %w", err)
	}
	// #nosec G703 -- Operator-configured database paths may be outside applicationRoot.
	if err := os.MkdirAll(filepath.Dir(databaseURL.Path), 0o750); err != nil {
		return "", fmt.Errorf("create SQLite data directory %q: %w", filepath.Dir(databaseURL.Path), err)
	}
	if err := os.Setenv("DATABASE_URL", dsn); err != nil {
		return "", fmt.Errorf("configure SQLite database URL: %w", err)
	}
	return dsn, nil
}

func resolveSQLiteDatabaseDSN(applicationRoot, dbPath, databaseURL string) (string, error) {
	if !filepath.IsAbs(applicationRoot) {
		return "", fmt.Errorf("SQLite application root must be absolute: %q", applicationRoot)
	}
	if dbPath != "" {
		return sqlitePathDSN(applicationRoot, dbPath)
	}
	if databaseURL == "" {
		databaseURL = defaultSQLitePath()
	}
	preferred, err := sqliteDatabaseURL(applicationRoot, databaseURL)
	if err != nil {
		return "", err
	}
	legacyPath := filepath.Join(applicationRoot, "app.db")
	if dataDir := os.Getenv("ARK_DATA_DIR"); dataDir != "" {
		legacyPath = filepath.Join(dataDir, "app.db")
	}
	legacy, err := sqliteFileURL(applicationRoot, legacyPath)
	if err != nil {
		return "", err
	}
	selectedPath, err := selectSQLiteDatabase(preferred.Path, legacy.Path)
	if err != nil {
		return "", err
	}
	preferred.Path = selectedPath
	return sqliteURLDSN(preferred)
}

func sqliteDatabaseURL(applicationRoot, databaseURL string) (*url.URL, error) {
	if !strings.HasPrefix(databaseURL, "file:") {
		if err := rejectSQLiteBackendScheme(databaseURL); err != nil {
			return nil, err
		}
		return sqliteFileURL(applicationRoot, databaseURL)
	}
	parsed, err := url.Parse(databaseURL)
	if err != nil {
		return nil, fmt.Errorf("parse SQLite database URL: %w", err)
	}
	if (parsed.Host != "" && parsed.Host != "localhost") || parsed.User != nil || parsed.Fragment != "" {
		return nil, fmt.Errorf("SQLite database URL must name a local file with empty or localhost authority and without credentials or fragment: %q", databaseURL)
	}
	if parsed.Opaque != "" {
		path, err := url.PathUnescape(parsed.Opaque)
		if err != nil {
			return nil, fmt.Errorf("decode SQLite database path: %w", err)
		}
		parsed.Path, parsed.Opaque = path, ""
	}
	if parsed.Query().Get("mode") == "memory" {
		return nil, fmt.Errorf("generated application requires a persistent SQLite file: %q", databaseURL)
	}
	resolved, err := sqliteFileURL(applicationRoot, parsed.Path)
	if err != nil {
		return nil, err
	}
	resolved.RawQuery = parsed.RawQuery
	return resolved, nil
}

func rejectSQLiteBackendScheme(path string) error {
	if filepath.IsAbs(path) {
		return nil
	}
	scheme, _, hasColon := strings.Cut(path, ":")
	if !hasColon || strings.ContainsAny(scheme, `/\`) {
		return nil
	}
	parsed, err := url.Parse(scheme + ":")
	if err != nil || parsed.Scheme == "" {
		return nil
	}
	return fmt.Errorf("generated application requires SQLite; unsupported database scheme %q", parsed.Scheme)
}

func sqliteFileURL(applicationRoot, path string) (*url.URL, error) {
	if path == "" || path == ":memory:" {
		return nil, fmt.Errorf("generated application requires a persistent SQLite file: %q", path)
	}
	resolved, err := resolveSQLiteFilePath(applicationRoot, path)
	if err != nil {
		return nil, err
	}
	return &url.URL{Scheme: "file", Path: resolved}, nil
}

func resolveSQLiteFilePath(applicationRoot, path string) (string, error) {
	if !filepath.IsAbs(path) {
		path = filepath.Join(applicationRoot, path)
	}
	path = filepath.Clean(path)
	canonicalPath, err := filepath.EvalSymlinks(path)
	if err == nil {
		return canonicalPath, nil
	}
	if !os.IsNotExist(err) {
		return "", fmt.Errorf("resolve SQLite database symlinks %q: %w", path, err)
	}
	return path, nil
}

func sqlitePathDSN(applicationRoot, dbPath string) (string, error) {
	parsed, err := sqliteFileURL(applicationRoot, dbPath)
	if err != nil {
		return "", err
	}
	return sqliteURLDSN(parsed)
}

// selectSQLiteDatabase probes before schema migrations, seeding, or directory creation.
func selectSQLiteDatabase(preferredPath, legacyPath string) (string, error) {
	preferredInfo, err := statSQLiteDatabase(preferredPath)
	if err != nil {
		return "", err
	}
	if preferredPath == legacyPath {
		_, err := sqliteDatabaseHasRows(preferredPath, preferredInfo)
		return preferredPath, err
	}
	legacyInfo, err := statSQLiteDatabase(legacyPath)
	if err != nil {
		return "", err
	}
	if preferredInfo != nil && legacyInfo != nil && os.SameFile(preferredInfo, legacyInfo) {
		path, err := sqliteAliasDatabasePath(preferredPath, legacyPath)
		if err != nil {
			return "", err
		}
		_, err = sqliteDatabaseHasRows(path, preferredInfo)
		return path, err
	}
	preferredPopulated, err := sqliteDatabaseHasRows(preferredPath, preferredInfo)
	if err != nil {
		return "", err
	}
	legacyPopulated, err := sqliteDatabaseHasRows(legacyPath, legacyInfo)
	if err != nil {
		return "", err
	}
	if preferredPopulated && legacyPopulated {
		return "", fmt.Errorf("SQLite database split: configured database %q and legacy domain database %q both contain stored rows; stop the application and reconcile these files offline before restarting; no database was copied or migrated", preferredPath, legacyPath)
	}
	if legacyPopulated {
		return legacyPath, nil
	}
	return preferredPath, nil
}

// Hardlinks share the database inode but have pathname-specific recovery files.
// Only aliases without live WAL or rollback journals can share a selected path.
func sqliteAliasDatabasePath(preferredPath, legacyPath string) (string, error) {
	for _, suffix := range []string{"-wal", "-journal"} {
		for _, path := range []string{preferredPath, legacyPath} {
			sidecarPath := path + suffix
			sidecar, err := statSQLiteDatabase(sidecarPath)
			if err != nil {
				return "", err
			}
			if sidecar != nil && sidecar.Size() > 0 {
				return "", fmt.Errorf("SQLite database hardlink aliases %q and %q have a nonempty recovery file %q; stop the application and reconcile these files offline before restarting; no database was copied or migrated", preferredPath, legacyPath, sidecarPath)
			}
		}
	}
	return legacyPath, nil
}

func statSQLiteDatabase(path string) (os.FileInfo, error) {
	// #nosec G703 -- Operator-configured database paths may be outside applicationRoot.
	info, err := os.Stat(path)
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("inspect SQLite database %q: %w", path, err)
	}
	if !info.Mode().IsRegular() {
		return nil, fmt.Errorf("SQLite database is not a regular file: %q", path)
	}
	return info, nil
}

// sqliteDatabaseHasRows reads WAL contents too; immutable=1 would hide them.
// Any application or migration row is retained, without schema-specific guesses.
func sqliteDatabaseHasRows(path string, info os.FileInfo) (populated bool, err error) {
	if info == nil {
		return false, nil
	}
	readURL := &url.URL{Scheme: "file", Path: path, RawQuery: "mode=ro"}
	db, err := sql.Open("sqlite", readURL.String())
	if err != nil {
		return false, fmt.Errorf("read SQLite database %q: %w", path, err)
	}
	defer func() {
		if closeErr := db.Close(); closeErr != nil && err == nil {
			err = fmt.Errorf("close SQLite database probe %q: %w", path, closeErr)
		}
	}()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	tables, err := sqliteDatabaseTables(ctx, db)
	if err != nil {
		return false, fmt.Errorf("inspect SQLite database %q: %w", path, err)
	}
	for _, table := range tables {
		quoted := `"` + strings.ReplaceAll(table, `"`, `""`) + `"`
		var populated bool
		if err := db.QueryRowContext(ctx, "SELECT EXISTS (SELECT 1 FROM "+quoted+" LIMIT 1)").Scan(&populated); err != nil {
			return false, fmt.Errorf("inspect SQLite database %q table %q: %w", path, table, err)
		}
		if populated {
			return true, nil
		}
	}
	return false, nil
}

func sqliteDatabaseTables(ctx context.Context, db *sql.DB) (tables []string, err error) {
	rows, err := db.QueryContext(ctx, "SELECT name FROM sqlite_master WHERE type='table' AND name NOT GLOB 'sqlite_*'")
	if err != nil {
		return nil, fmt.Errorf("list SQLite database tables: %w", err)
	}
	defer func() {
		if closeErr := rows.Close(); closeErr != nil && err == nil {
			err = fmt.Errorf("close SQLite database table listing: %w", closeErr)
		}
	}()
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, fmt.Errorf("read SQLite database table name: %w", err)
		}
		tables = append(tables, name)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate SQLite database tables: %w", err)
	}
	return tables, nil
}

// sqliteURLDSN adds missing defaults without overriding explicit URI settings.
func sqliteURLDSN(databaseURL *url.URL) (string, error) {
	query, err := url.ParseQuery(databaseURL.RawQuery)
	if err != nil {
		return "", fmt.Errorf("parse SQLite database options: %w", err)
	}
	configured := make(map[string]bool)
	for _, pragma := range query["_pragma"] {
		name := strings.FieldsFunc(pragma, func(r rune) bool { return r == '(' || r == '=' || r == ' ' || r == '\t' })
		if len(name) > 0 {
			configured[strings.ToLower(name[0])] = true
		}
	}
	for _, pragma := range []struct{ name, value string }{
		{"foreign_keys", "foreign_keys(1)"}, {"journal_mode", "journal_mode(WAL)"}, {"busy_timeout", "busy_timeout(5000)"},
	} {
		if !configured[pragma.name] {
			query.Add("_pragma", pragma.value)
		}
	}
	if query.Get("_txlock") == "" {
		query.Set("_txlock", "immediate")
	}
	databaseURL.RawQuery = query.Encode()
	return databaseURL.String(), nil
}
