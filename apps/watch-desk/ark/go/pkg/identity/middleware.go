package identity

import "net/http"

// Middleware returns HTTP middleware that resolves the user's identity from the
// forwarded OIDC token and stores it in the request context (read via
// FromContext). There is ONE identity contract — the bearer token — in every
// environment:
//
//   - Production (UDS): Authservice completes the OIDC handshake and the UDS
//     operator's Istio RequestAuthentication validates the Keycloak token at the
//     ambient waypoint, forwarding it to the app as `Authorization: Bearer <jwt>`
//     (forwardOriginalToken). See jwt.go.
//   - Dev (ARK_MOCK_AUTH=1): the MockAuthservice shim is chained in front and
//     mints the SAME `Authorization: Bearer` token from a cookie-backed mock
//     session — a faithful local stand-in for Keycloak + Istio + Authservice, so
//     the app's decode path is byte-for-byte identical in dev and prod.
func Middleware(cfg *RoleConfig) func(http.Handler) http.Handler {
	real := realMiddleware(cfg)
	if !MockAuthServiceEnabled() {
		return real
	}
	mock := MockAuthservice(cfg)

	return func(next http.Handler) http.Handler {
		return mock(real(next))
	}
}

// realMiddleware resolves identity from the forwarded OIDC token and stores it
// in context. It never fabricates an identity — an upstream layer (UDS
// Authservice in prod, MockAuthservice in dev) supplies the token; absent one,
// FromContext returns nil and handlers reject with CodePermissionDenied.
func realMiddleware(cfg *RoleConfig) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ctx := NewContext(r.Context(), identityFromBearer(r, cfg))
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}
