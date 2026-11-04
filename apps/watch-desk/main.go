// Package main composes the application's schema, services, and frontend.
package main

import (
	"context"
	"database/sql"
	"embed"
	"fmt"
	"log/slog"
	"os"

	"entgo.io/ent/dialect"
	entsql "entgo.io/ent/dialect/sql"
	ark "github.com/defenseunicorns/ark/framework/go"
	"github.com/defenseunicorns/generated-app/ent"
	"github.com/defenseunicorns/generated-app/internal/service"
)

//go:embed all:ui/build
var assets embed.FS

func main() {
	root, err := os.Getwd()
	if err != nil {
		slog.Error("Resolve application root", "error", err)
		return
	}
	if err := ark.RunApplicationUntilSignal(ark.ApplicationOptions{
		Root: root, Assets: &assets, InitializeDatabase: initializeDatabase,
		RegisterServices: service.InitAll,
	}); err != nil {
		slog.Error("Application stopped", "error", err)
	}
}

// The app owns its generated ENT client and schema migration choices.
func initializeDatabase(ctx context.Context, db *sql.DB) (any, func() error, error) {
	client := ent.NewClient(ent.Driver(entsql.OpenDB(dialect.SQLite, db)))
	if err := client.Schema.Create(ctx); err != nil {
		return nil, nil, fmt.Errorf("create application schema: %w", err)
	}
	return client, client.Close, nil
}
