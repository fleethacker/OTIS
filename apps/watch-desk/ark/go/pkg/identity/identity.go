// Package identity provides user identity and role-based access control for
// Ark apps.
//
// In production (UDS), Keycloak handles login and Authservice completes the
// OIDC handshake; the UDS operator's Istio RequestAuthentication validates the
// token at the ambient waypoint and forwards it to the app as
// `Authorization: Bearer <jwt>` (forwardOriginalToken). This package decodes
// that mesh-validated token and resolves the user's groups to an app role (see
// jwt.go). UDS does NOT send oauth2-proxy-style X-Auth-Request-* headers.
//
// In dev/preview, the ARK_MOCK_AUTH=1 env var tells Middleware to chain
// the MockAuthservice shim in front of the real resolver. The shim serves
// a self-contained mock login page at /__ark/mock-login, persists the
// selected role in a session cookie, and mints an Authorization bearer token.
// The same bearer-token resolver supplies the app's Identity in both environments.
package identity

import (
	"context"
	"slices"
)

// Identity represents the current user's identity and resolved app role.
type Identity struct {
	// Subject is Ark's effective owner ID, selected by EnvIdentityClaim from
	// the verified token. It is independent of display metadata.
	Subject  string   `json:"subject"`
	Name     string   `json:"name"`
	Username string   `json:"username"`
	Email    string   `json:"email"`
	Groups   []string `json:"groups"`
	Role     string   `json:"role"`
}

type contextKey struct{}

// NewContext returns a new context with the given identity stored in it.
func NewContext(ctx context.Context, id *Identity) context.Context {
	return context.WithValue(ctx, contextKey{}, id)
}

// FromContext extracts the identity from the context. Returns nil if not present.
func FromContext(ctx context.Context) *Identity {
	id, _ := ctx.Value(contextKey{}).(*Identity)
	return id
}

// HasGroup reports exact membership in a group from the upstream identity.
// Roles and matching leaf names in other group paths do not imply membership.
func (id *Identity) HasGroup(group string) bool {
	if id == nil || group == "" {
		return false
	}
	return slices.Contains(id.Groups, group)
}
