package ark

import (
	"context"
	"database/sql"
	"embed"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"

	"github.com/defenseunicorns/ark/framework/go/pkg/identity"
	"github.com/defenseunicorns/ark/framework/go/pkg/requestlog"
	"github.com/defenseunicorns/ark/framework/go/pkg/seed"
	"github.com/go-chi/chi/v5"
)

// ApplicationOptions supplies the application-specific database and services.
// The generated ENT client and embedded frontend remain application-owned.
type ApplicationOptions struct {
	Root               string
	Assets             *embed.FS
	Logger             *slog.Logger
	InitializeDatabase func(context.Context, *sql.DB) (any, func() error, error)
	RegisterServices   func(ServiceDeps)
}

// RunApplication configures the shared startup contract and serves until canceled.
// Root must be absolute; seed and role paths resolve against it, never the cwd.
func RunApplication(ctx context.Context, options ApplicationOptions) (returnErr error) {
	if err := validateApplicationOptions(ctx, options); err != nil {
		return err
	}
	if options.Logger == nil {
		options.Logger = slog.Default()
	}
	dsn, err := ConfigureSQLiteDatabase(options.Root)
	if err != nil {
		return fmt.Errorf("configure application database: %w", err)
	}
	app, err := NewApplication(options.Logger)
	if err != nil {
		return err
	}
	defer func() { returnErr = errors.Join(returnErr, app.Stop()) }()
	if err := initializeApplicationDatabase(ctx, app, options.InitializeDatabase); err != nil {
		return err
	}
	if err := seed.AutoSeedContext(ctx, dsn, applicationInputPath(options.Root, "ARK_SEED_PATH", "seed_data.json"), options.Logger); err != nil {
		return fmt.Errorf("seed application database: %w", err)
	}
	roles, err := identity.LoadConfig(applicationInputPath(options.Root, "ARK_ROLES_PATH", "roles.json"))
	if err != nil {
		return fmt.Errorf("load application roles: %w", err)
	}
	app.ConfigureRoutes(func(mux *chi.Mux) { mux.Use(identity.Middleware(roles), requestlog.Identity) })
	options.RegisterServices(ServiceDeps{App: app, Roles: roles})
	app.ServeStatic(options.Assets, "/")
	if err := app.Start(ctx); err != nil {
		return fmt.Errorf("serve application: %w", err)
	}
	return nil
}

func validateApplicationOptions(ctx context.Context, options ApplicationOptions) error {
	if err := ctx.Err(); err != nil {
		return fmt.Errorf("application startup canceled: %w", err)
	}
	if !filepath.IsAbs(options.Root) {
		return fmt.Errorf("application root must be absolute: %q", options.Root)
	}
	if options.Assets == nil || options.InitializeDatabase == nil || options.RegisterServices == nil {
		return fmt.Errorf("application startup requires frontend assets, database initialization, and service registration")
	}
	return nil
}

func initializeApplicationDatabase(ctx context.Context, app *Application,
	initialize func(context.Context, *sql.DB) (any, func() error, error),
) error {
	db, err := app.Storage.SQLiteDB()
	if err != nil {
		return fmt.Errorf("open application database: %w", err)
	}
	client, closeClient, err := initialize(ctx, db)
	if err != nil {
		return fmt.Errorf("initialize application schema: %w", errors.Join(err, db.Close()))
	}
	if err := app.Storage.SetEntClient(client, closeClient); err != nil {
		if closeClient != nil {
			return fmt.Errorf("register application database: %w", errors.Join(err, closeClient()))
		}
		return fmt.Errorf("register application database: %w", errors.Join(err, db.Close()))
	}
	return nil
}

func applicationInputPath(root, key, filename string) string {
	name := os.Getenv(key)
	if name == "" {
		return filepath.Join(root, "internal", "data", filename)
	}
	if filepath.IsAbs(name) {
		return name
	}
	return filepath.Join(root, name)
}
