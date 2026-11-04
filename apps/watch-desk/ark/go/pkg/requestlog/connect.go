package requestlog

import (
	"context"
	"log/slog"

	"connectrpc.com/connect"
)

// Interceptor adds RPC outcomes and severity to the HTTP completion record,
// including streaming failures after HTTP 200, without logging error payloads.
func Interceptor() connect.Interceptor { return rpcInterceptor{} }

type rpcInterceptor struct{}

// WrapUnary records the returned Connect outcome.
func (rpcInterceptor) WrapUnary(next connect.UnaryFunc) connect.UnaryFunc {
	return func(ctx context.Context, req connect.AnyRequest) (connect.AnyResponse, error) {
		Add(ctx, "rpc_method", req.Spec().Procedure)
		response, err := next(ctx, req)
		if recordCallerCancellation(ctx, err) {
			Add(ctx, "rpc_code", connect.CodeCanceled.String())
			return response, connect.NewError(connect.CodeCanceled, err)
		}
		recordRPC(ctx, err)
		return response, err
	}
}

// WrapStreamingHandler records failures after a stream has started.
func (rpcInterceptor) WrapStreamingHandler(next connect.StreamingHandlerFunc) connect.StreamingHandlerFunc {
	return func(ctx context.Context, conn connect.StreamingHandlerConn) error {
		Add(ctx, "rpc_method", conn.Spec().Procedure)
		err := next(ctx, conn)
		if RecordStreamCancellation(ctx, err) {
			Add(ctx, "rpc_code", connect.CodeCanceled.String())
			return connect.NewError(connect.CodeCanceled, err)
		}
		recordRPC(ctx, err)
		return err
	}
}

// WrapStreamingClient leaves client behavior unchanged.
func (rpcInterceptor) WrapStreamingClient(next connect.StreamingClientFunc) connect.StreamingClientFunc {
	return next
}

func recordRPC(ctx context.Context, err error) {
	code := "ok"
	if err != nil {
		code = connect.CodeOf(err).String()
	}
	Add(ctx, "rpc_code", code)
	if err == nil {
		return
	}
	level := slog.LevelWarn
	switch connect.CodeOf(err) {
	case connect.CodeInternal, connect.CodeUnknown, connect.CodeUnavailable, connect.CodeDataLoss:
		level = slog.LevelError
	}
	if e, ok := ctx.Value(contextKey{}).(*entry); ok {
		e.mu.Lock()
		e.errorLevel = max(e.errorLevel, level)
		e.mu.Unlock()
	}
}
