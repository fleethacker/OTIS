// Package service contains the business logic and ConnectRPC service implementations.
package service

import (
	"context"
	"log/slog"

	"connectrpc.com/connect"
	appv1 "github.com/defenseunicorns/generated-app/gen/app/v1"
	"github.com/defenseunicorns/generated-app/gen/app/v1/appv1connect"
	"github.com/go-chi/chi/v5"

	"github.com/defenseunicorns/ark/framework/go/pkg/connectrpc"
	"github.com/defenseunicorns/ark/framework/go/pkg/identity"
)

// AppService implements the generated AppService ConnectRPC service.
type AppService struct {
	*connectrpc.BaseService
	logger *slog.Logger
	roles  *identity.RoleConfig
}

func init() {
	registerService(func(deps ServiceDeps) {
		svc := NewAppService(deps.App.Logger, deps.Roles)
		deps.App.AddService(svc)
	})
}

// NewAppService creates a new app service.
func NewAppService(logger *slog.Logger, roles *identity.RoleConfig) *AppService {
	return &AppService{
		BaseService: connectrpc.NewBaseService(),
		logger:      logger,
		roles:       roles,
	}
}

// Register implements the ServiceRegistrar interface.
func (s *AppService) Register(mux *chi.Mux, interceptors ...connect.Interceptor) {
	opts := connectrpc.HandlerOptions(append(s.Interceptors(), interceptors...)...)
	path, handler := appv1connect.NewAppServiceHandler(s, opts...)
	mux.Handle(path+"*", handler)

	s.logger.Info("app service registered", "path", path)
}

// Health implements the Health RPC method.
func (s *AppService) Health(
	ctx context.Context,
	_ *connect.Request[appv1.HealthRequest],
) (*connect.Response[appv1.HealthResponse], error) {
	s.logger.InfoContext(ctx, "health check")

	return connect.NewResponse(&appv1.HealthResponse{
		Healthy: true,
		Message: "Application is running",
	}), nil
}

// Info implements the Info RPC method.
func (s *AppService) Info(
	ctx context.Context,
	_ *connect.Request[appv1.InfoRequest],
) (*connect.Response[appv1.InfoResponse], error) {
	s.logger.InfoContext(ctx, "info request")

	return connect.NewResponse(&appv1.InfoResponse{
		Name:        "Generated Application",
		Version:     "0.1.0",
		Description: "Ark-generated application with ConnectRPC",
	}), nil
}
