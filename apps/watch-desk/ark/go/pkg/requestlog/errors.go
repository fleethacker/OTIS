package requestlog

import (
	"context"
	"errors"
	"log/slog"
	"net/url"
)

type proxyErrorObserverKey struct{}

// WithProxyErrorObserver reports confirmed upstream failures to outer HTTP
// instrumentation, including body-read failures followed by ErrAbortHandler.
// The observer receives no error payload and must support concurrent calls.
func WithProxyErrorObserver(ctx context.Context, observe func()) context.Context {
	return context.WithValue(ctx, proxyErrorObserverKey{}, observe)
}

// ProxyError retains the transport failure without logging the upstream URL,
// whose query or userinfo may contain a capability or credential.
// Confirmed caller cancellation is recorded on the completion log instead.
func ProxyError(ctx context.Context, err error, attrs ...any) {
	if recordCallerCancellation(ctx, err) {
		return
	}
	if observe, ok := ctx.Value(proxyErrorObserverKey{}).(func()); ok && observe != nil {
		observe()
	}
	Add(ctx, "request_end", "upstream_error")
	if e, ok := ctx.Value(contextKey{}).(*entry); ok {
		e.mu.Lock()
		e.errorLevel = slog.LevelError
		e.mu.Unlock()
	}
	if urlErr, ok := errors.AsType[*url.Error](err); ok {
		err = urlErr.Err
	}
	Logger(ctx).ErrorContext(ctx, "http upstream request failed", append(attrs, "error", err)...)
}

// RecordStreamCancellation distinguishes caller cancellation from cancellation
// of a server-owned stream context. Unrelated failures are left unchanged.
func RecordStreamCancellation(ctx context.Context, err error) bool {
	if ctx.Err() != context.Canceled || !errors.Is(err, context.Canceled) {
		return false
	}
	ending := "server_canceled"
	if recordCallerCancellation(ctx, err) {
		ending = "client_canceled"
	}
	Add(ctx, "stream_end", ending)
	return true
}

// recordCallerCancellation checks the original HTTP context so canceling a
// server-owned child context cannot hide an upstream failure.
func recordCallerCancellation(ctx context.Context, err error) bool {
	callerContext := ctx
	e, ok := ctx.Value(contextKey{}).(*entry)
	if ok {
		callerContext = e.callerContext
	}
	if callerContext == nil || callerContext.Err() != context.Canceled || !errors.Is(err, context.Canceled) {
		return false
	}
	Add(ctx, "request_end", "client_canceled")
	if ok {
		e.mu.Lock()
		e.clientCanceled = true
		e.mu.Unlock()
	}
	return true
}
