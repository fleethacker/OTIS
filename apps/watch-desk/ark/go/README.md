# Ark Go Framework

Framework libraries for building production-ready Go backend services with Ark.

## Overview

This framework provides the foundation for all Ark-generated Go applications, offering:

- **HTTP Server**: Chi-based HTTP server with middleware
- **ConnectRPC Integration**: Type-safe RPC services with protocol buffers
- **Database Layer**: Persistent SQLite for generated applications; lower-level storage APIs also
  support PostgreSQL
- **Background Jobs**: River-based job processing
- **Health Checks**: Built-in health and status endpoints
- **Configuration**: Viper-based configuration management

## Quick Start

Generated applications use `ark.RunApplicationUntilSignal` with an absolute
application root, embedded `ui/build` assets, an ENT initializer, and service
registrations. See the complete [template entrypoint](../../template/main.go).
That startup path configures a persistent SQLite file for domain data and jobs,
loads seeds and roles, installs identity middleware, and handles shutdown.
PostgreSQL URLs and in-memory databases are rejected by this startup contract.
Application queries and River use separate SQLite pools against the same file.
River's private pool admits write transactions and completes commits with bounded,
context-aware lock waits. Failed operations roll back or retire the connection;
application statements and whole transactions are never replayed. Existing app
bootstraps and stored jobs stay in place without an app compatibility migration.
The default startup uses immediate transactions. An explicitly deferred
application transaction that upgrades an old read snapshot still needs its own
application-level recovery; River cannot replay that caller-owned transaction.

The following example uses the lower-level application API for custom composition:

```go
package main

import (
    "context"
    "log/slog"
    "os"

    "github.com/defenseunicorns/ark/framework/go"
)

func main() {
    logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))

    // Create application with framework defaults
    app, err := ark.NewApplication(logger)
    if err != nil {
        logger.Error("Failed to create application", "error", err)
        os.Exit(1)
    }
    defer app.Stop()

    // Add your ConnectRPC services
    // app.AddService(myService)

    // Start the application
    ctx := context.Background()
    if err := app.Start(ctx); err != nil {
        logger.Error("Application failed", "error", err)
        os.Exit(1)
    }
}
```

## Architecture

### Core Components

#### Application (`ark.Application`)

The main application struct that orchestrates all framework components.

```go
app, err := ark.NewApplication(logger)
```

Features:

- Automatic environment variable configuration
- Database connection management
- HTTP server setup with middleware
- Background job processing (optional)
- Health check endpoints

#### Server (`pkg/server`)

Chi-based HTTP server with:

- Standard middleware (logging, recovery, compression)
- Static file serving
- Graceful shutdown
- Configurable HTTP server timeouts; request timeout middleware is omitted to preserve streaming
  RPCs

```go
server := server.New(config, logger)
server.ServeStatic(embedFS, "/static/")
```

#### Storage (`pkg/storage`)

Unified database layer supporting:

- SQLite for generated applications in development and production
- PostgreSQL through lower-level storage APIs for custom compositions
- ENT ORM integration
- River queue integration
- Health checking

```go
storage, err := storage.NewStorage("postgres", "postgresql://...")
```

#### ConnectRPC (`pkg/connectrpc`)

ConnectRPC service registration and interceptors:

- Base service pattern
- Authentication interceptor
- Error handling interceptor
- Logging interceptor (template)

```go
type MyService struct {
    *connectrpc.BaseService
}

func (s *MyService) Register(mux *chi.Mux, interceptors ...connect.Interceptor) {
    // Service registration
}
```

#### Health Service (`pkg/health`)

Standard health and info endpoints:

- `GET /api/health` - Component health status
- `GET /api/info` - Application metadata

```go
health := health.NewService("My App", "1.0.0")
health.RegisterRoutes(router)
```

#### Configuration (`pkg/config`)

Viper-based configuration with:

- YAML file loading
- Directory-based multi-file config
- Environment variable overrides
- Type-safe generics

`LoadFromDirectory` reads only `config.yaml` and `ark_*.yaml` in the supplied
directory. Other YAML filenames are ignored. Accepted files merge in lexical
filename order; later files override earlier keys. A missing directory or one
without accepted files uses the supplied defaults and environment overrides.
Invalid accepted files return an error. Both loaders apply `ARK_` environment
overrides to struct fields even when those keys are absent from YAML.

```go
config, err := config.LoadFromFile("config.yaml", defaultConfig)
config, err := config.LoadFromDirectory("config/", defaultConfig)
```

## Package Structure

```text
framework/ark/go/               # module github.com/defenseunicorns/ark/framework/go
├── ark.go                      # Main application orchestration
├── pkg/
│   ├── config/                 # Configuration management
│   ├── connectrpc/             # ConnectRPC utilities (interceptors, registration)
│   ├── health/                 # Health endpoints
│   ├── identity/               # Auth / identity context helpers
│   ├── seed/                   # Seed-data loading
│   ├── server/                 # HTTP server
│   ├── storage/                # Database & queue
│   └── textclean/              # Text sanitization helpers
└── examples/                   # Example application
    ├── main.go
    └── config.yaml
```

## Environment Variables

The framework respects these environment variables:

- `DATABASE_URL` - SQLite file URL for generated startup; lower-level storage APIs can use other
  drivers
- `ARK_DB_PATH` - Explicit SQLite file path for generated startup, resolved against the application
  root
- `PORT` - HTTP server port (default: 8080)
- `ARK_*` - Application-specific config overrides

Example:

```bash
ARK_DB_PATH=data/application.db
PORT=3000
```

## Development Patterns

### Service Development

```go
type MyService struct {
    *connectrpc.BaseService
    storage *storage.Storage
    logger  *slog.Logger
}

func NewMyService(storage *storage.Storage, logger *slog.Logger) *MyService {
    return &MyService{
        BaseService: connectrpc.NewBaseService(),
        storage:     storage,
        logger:      logger,
    }
}

func (s *MyService) Register(mux *chi.Mux, interceptors ...connect.Interceptor) {
    opts := connectrpc.HandlerOptions(append(s.Interceptors(), interceptors...)...)
    path, handler := myv1connect.NewMyServiceHandler(s, opts...)
    mux.Handle(path+"*", handler)
}
```

`HandlerOptions` limits each decoded request message to 80 MiB, including
compressed messages, before validation and service code run. Use it for every
generated handler; interceptors alone do not bound message decoding.

### Background Jobs

Register each typed worker with River, then call `app.AddWorker` to enable
background job processing when the application starts. `app.AddWorker` counts
workers for startup; it does not add them to River's registry.

```go
// Define job args
type EmailJobArgs struct {
    To      string
    Subject string
    Body    string
}

func (EmailJobArgs) Kind() string { return "email" }

// Implement river.Worker
type EmailWorker struct {
    river.WorkerDefaults[EmailJobArgs]
}

func (w *EmailWorker) Work(ctx context.Context, job *river.Job[EmailJobArgs]) error {
    // Send email
    return sendEmail(job.Args.To, job.Args.Subject, job.Args.Body)
}

// Register with River before enabling application background jobs.
worker := &EmailWorker{}
river.AddWorker(app.Workers, worker)
if err := app.AddWorker(worker); err != nil {
    return err
}
```

### Custom Routes

```go
app.ConfigureRoutes(func(r *chi.Mux) {
    r.Get("/custom", customHandler)
    r.Post("/webhook", webhookHandler)
})
```

### Static File Serving

```go
//go:embed all:ui/build
var staticAssets embed.FS

app.ServeStatic(&staticAssets, "/static/")
```

## Testing

```bash
# Run all tests
go test ./...

# Run with coverage
go test -cover ./...

# Run specific package
go test ./pkg/storage
```

## Best Practices

1. **Use Dependency Injection**: Pass dependencies through constructors
2. **Structured Logging**: Use slog for consistent logging
3. **Error Wrapping**: Use `fmt.Errorf` with `%w` for error chains
4. **Configuration**: Use struct tags for viper/yaml mapping
5. **Context Propagation**: Always pass context through call chains
6. **Testing**: Write table-driven tests with clear scenarios

## Examples

See the `examples/` directory for complete working examples:

- `examples/main.go` - Basic application

Per-deployment configuration (database URL, port, etc.) is environment-driven — set `DATABASE_URL` /
`PORT` and `NewApplication(logger)` resolves the rest.

## Contributing

When modifying the framework:

1. Maintain backward compatibility
2. Add tests for new features
3. Update documentation
4. Follow Go best practices
5. Run tests before committing

## License

See repository root for license information.
