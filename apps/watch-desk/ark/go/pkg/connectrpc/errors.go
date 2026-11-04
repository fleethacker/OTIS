package connectrpc

import (
	"context"
	"errors"
	"log/slog"

	"connectrpc.com/connect"
)

// ErrorKind classifies domain errors without importing an application's
// generated ENT client or exposing its database/schema error text.
type ErrorKind int

// Error kinds distinguish safe domain responses from internal failures.
const (
	ErrorUnknown ErrorKind = iota
	ErrorNotFound
	ErrorValidation
	ErrorConstraint
	ErrorNotSingular
)

// MapError retains explicit Connect errors and sanitizes other domain errors.
// The application supplies its generated client's error classification only;
// generic wire messages and server-side logging belong to the framework.
func MapError(err error, classify func(error) ErrorKind) error {
	if err == nil {
		return nil
	}
	if existing, ok := errors.AsType[*connect.Error](err); ok {
		return existing
	}
	// Request cancellation is a transport outcome, not an application failure.
	// Use the canonical cause so wrapped private details stay off the wire.
	for _, transport := range []struct {
		cause error
		code  connect.Code
	}{
		{context.Canceled, connect.CodeCanceled},
		{context.DeadlineExceeded, connect.CodeDeadlineExceeded},
	} {
		if errors.Is(err, transport.cause) {
			slog.Debug("request ended", "code", transport.code.String(), "cause", err)
			return connect.NewError(transport.code, transport.cause)
		}
	}
	kind := ErrorUnknown
	if classify != nil {
		kind = classify(err)
	}
	code, message := connect.CodeInternal, "internal error"
	switch kind {
	case ErrorNotFound:
		code, message = connect.CodeNotFound, "not found"
	case ErrorValidation:
		code, message = connect.CodeInvalidArgument, "invalid argument"
	case ErrorConstraint:
		code, message = connect.CodeAlreadyExists, "already exists"
	}
	if code == connect.CodeInternal {
		slog.Error("mapped application error", "code", code.String(), "cause", err)
	} else {
		slog.Debug("mapped application error", "code", code.String(), "cause", err)
	}
	return connect.NewError(code, errors.New(message))
}
