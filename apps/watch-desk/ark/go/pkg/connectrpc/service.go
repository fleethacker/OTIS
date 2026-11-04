// Package connectrpc provides ConnectRPC utilities for Ark applications
package connectrpc

import (
	"context"
	"fmt"
	"slices"

	"buf.build/go/protovalidate"
	"connectrpc.com/connect"
	"github.com/go-chi/chi/v5"
	"google.golang.org/protobuf/proto"
)

// ServiceRegistrar defines the interface for registering ConnectRPC services
type ServiceRegistrar interface {
	Register(mux *chi.Mux, interceptors ...connect.Interceptor)
}

// BaseService provides common functionality for ConnectRPC services
type BaseService struct {
	interceptors []connect.Interceptor
}

// NewBaseService creates a new base service with optional interceptors
func NewBaseService(interceptors ...connect.Interceptor) *BaseService {
	return &BaseService{
		interceptors: slices.Clone(interceptors),
	}
}

// Interceptors returns a copy of the base service interceptors
func (s *BaseService) Interceptors() []connect.Interceptor {
	return slices.Clone(s.interceptors)
}

// RegisterServices registers multiple ConnectRPC services with the router
func RegisterServices(mux *chi.Mux, services []ServiceRegistrar, globalInterceptors ...connect.Interceptor) {
	for _, service := range services {
		service.Register(mux, globalInterceptors...)
	}
}

// AuthInterceptor provides authentication functionality for ConnectRPC services
func AuthInterceptor(authFunc func(context.Context, connect.Spec) error) connect.UnaryInterceptorFunc {
	return func(next connect.UnaryFunc) connect.UnaryFunc {
		return func(ctx context.Context, req connect.AnyRequest) (connect.AnyResponse, error) {
			if err := authFunc(ctx, req.Spec()); err != nil {
				return nil, connect.NewError(connect.CodeUnauthenticated, fmt.Errorf("authentication failed: %w", err))
			}
			return next(ctx, req)
		}
	}
}

// LoggingInterceptor provides basic logging functionality for ConnectRPC services
// Applications should provide their own logger-based interceptor using this as a template
func LoggingInterceptor() connect.UnaryInterceptorFunc {
	return func(next connect.UnaryFunc) connect.UnaryFunc {
		return func(ctx context.Context, req connect.AnyRequest) (connect.AnyResponse, error) {
			resp, err := next(ctx, req)
			return resp, err
		}
	}
}

// ErrorInterceptor provides standardized error handling
func ErrorInterceptor() connect.UnaryInterceptorFunc {
	return func(next connect.UnaryFunc) connect.UnaryFunc {
		return func(ctx context.Context, req connect.AnyRequest) (connect.AnyResponse, error) {
			resp, err := next(ctx, req)
			if err != nil {
				// Convert internal errors to appropriate ConnectRPC errors
				if connectErr, ok := err.(*connect.Error); ok {
					return nil, connectErr
				}
				// Wrap generic errors
				return nil, connect.NewError(connect.CodeInternal, err)
			}
			return resp, nil
		}
	}
}

// ValidationInterceptor enforces (buf.validate.field) rules declared in the
// proto schema. Every unary request is validated before reaching the handler;
// violations become InvalidArgument errors. Non-proto requests pass through
// (shouldn't happen in ConnectRPC but the type assertion guards against it).
func ValidationInterceptor(validator protovalidate.Validator) connect.UnaryInterceptorFunc {
	return func(next connect.UnaryFunc) connect.UnaryFunc {
		return func(ctx context.Context, req connect.AnyRequest) (connect.AnyResponse, error) {
			if msg, ok := req.Any().(proto.Message); ok {
				if err := validator.Validate(msg); err != nil {
					return nil, connect.NewError(connect.CodeInvalidArgument, err)
				}
			}

			return next(ctx, req)
		}
	}
}
