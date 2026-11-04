// Package enterrors adapts the app's generated ENT errors to Ark's wire policy.
package enterrors

import (
	"github.com/defenseunicorns/ark/framework/go/pkg/connectrpc"
	"github.com/defenseunicorns/generated-app/ent"
)

// Map preserves the app handler API while Ark sanitizes database error details.
//
//nolint:wrapcheck // Delegate unchanged so Connect keeps the framework's sanitized code and message.
func Map(err error) error { return connectrpc.MapError(err, classify) }

func classify(err error) connectrpc.ErrorKind {
	switch {
	case ent.IsNotFound(err):
		return connectrpc.ErrorNotFound
	case ent.IsValidationError(err):
		return connectrpc.ErrorValidation
	case ent.IsConstraintError(err):
		return connectrpc.ErrorConstraint
	case ent.IsNotSingular(err):
		return connectrpc.ErrorNotSingular
	default:
		return connectrpc.ErrorUnknown
	}
}
