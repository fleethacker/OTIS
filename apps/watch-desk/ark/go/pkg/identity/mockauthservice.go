package identity

import (
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"strings"
)

// Reserved paths + cookie for the mock Authservice simulation. The real
// Authservice in UDS exposes similar endpoints (e.g. /oauth/callback); we
// namespace ours under /__ark/ so a generated app can never collide.
const (
	mockSessionCookie = "ark_session"
	mockLoginPath     = "/__ark/mock-login"
	mockLogoutPath    = "/__ark/mock-logout"
	logoutPath        = "/logout"
	mockRolesPath     = "/__ark/mock-roles"
	mockWhoamiPath    = "/__ark/mock-whoami"

	// One-week session feels right for a dev convenience cookie; not a
	// security boundary since the whole shim is dev-only.
	mockSessionMaxAge = 60 * 60 * 24 * 7

	// EnvMockAuth toggles the mock auth shim. The wizard's preview manager
	// sets this to "1" when spawning air; production UDS deployments leave
	// it unset so real Authservice headers flow unimpeded.
	EnvMockAuth = "ARK_MOCK_AUTH"

	// EnvMockAuthAs auto-logs-in un-sessioned requests as a fixed role, so the
	// whoami probe returns 200 instead of 401 and AuthGate renders the app
	// without a login round-trip. Set to "1" for the default role, or to a
	// specific role name. The journey-test ephemeral stack sets this so specs
	// don't have to script a login; the wizard PREVIEW leaves it UNSET so its
	// 401→role-picker UX is preserved. Dev-only, same as the shim itself.
	EnvMockAuthAs = "ARK_MOCK_AUTH_AS"

	// mockAutoLoginDefault is the EnvMockAuthAs sentinel meaning "the config's
	// default role" — so a caller can opt in without knowing role names.
	mockAutoLoginDefault = "1"
)

// mockAutoLoginRole returns the role un-sessioned requests should be treated
// as, per EnvMockAuthAs, or "" when auto-login is off (the preview's case).
// "1" maps to cfg.DefaultRole; any other non-empty value must name a real
// role (an unknown name is ignored with a warning, never silently downgraded).
func mockAutoLoginRole(cfg *RoleConfig) string {
	switch v := os.Getenv(EnvMockAuthAs); {
	case v == "":
		return ""
	case v == mockAutoLoginDefault:
		return cfg.DefaultRole
	default:
		if _, ok := cfg.Roles[v]; ok {
			return v
		}
		slog.Warn("identity: ARK_MOCK_AUTH_AS names an unknown role; ignoring", "role", v)

		return ""
	}
}

// MockAuthServiceEnabled reports whether the mock shim is active for this
// process. Used by Middleware to decide whether to chain MockAuthservice
// in front of the real identity resolver.
func MockAuthServiceEnabled() bool {
	return os.Getenv(EnvMockAuth) == "1"
}

// MockAuthservice returns middleware that simulates UDS Authservice in dev.
//
// Behaviour:
//   - Strips any inbound Authorization header so a browser-side attacker can't
//     forge a token (defense in depth; matches what Istio + Authservice do at
//     the mesh boundary, where client-supplied creds are stripped).
//   - Reads the ark_session cookie to find the selected mock role.
//   - If the cookie is valid, mints the SAME `Authorization: Bearer <OIDC token>`
//     that UDS forwards in production (forwardOriginalToken) and sets it on the
//     request. The downstream Middleware then decodes the exact same shape it
//     gets in production UDS.
//   - Without a session cookie, ordinary requests use EnvMockAuthAs when set to
//     a valid role (or "1" for the default); otherwise they use cfg.DefaultRole.
//     This fallback does not create a session cookie.
//   - The /__ark/mock-whoami probe requires a session or explicit EnvMockAuthAs
//     auto-login; without either it returns 401 so the UI can show the role picker.
//   - If the cookie references an unknown role, clears it and redirects to the
//     mock login page, preserving the original path in `return=`.
//   - Short-circuits its own /__ark/mock-* endpoints before they reach the
//     app router.
//
// This middleware must NOT be installed in production. Middleware chains it
// automatically when ARK_MOCK_AUTH=1 is set.
func MockAuthservice(cfg *RoleConfig) func(http.Handler) http.Handler {
	slog.Info("identity: mock Authservice enabled — development mode only",
		"login_path", mockLoginPath)

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			switch r.URL.Path {
			case mockLoginPath:
				handleMockLogin(w, r, cfg)

				return
			case mockLogoutPath, logoutPath:
				handleMockLogout(w, r)

				return
			case mockRolesPath:
				handleMockRoles(w, r, cfg)

				return
			case mockWhoamiPath:
				handleMockWhoami(w, r, cfg)

				return
			}

			// Browsers can set arbitrary headers on fetches; strip the inbound
			// Authorization so only this middleware mints the token (mirrors the
			// mesh stripping client-supplied creds).
			r.Header.Del("Authorization")

			roleName := readSessionCookie(r)
			if roleName == "" {
				// No session cookie. Use a fallback role for THIS request's
				// headers so un-sessioned Connect RPCs get a valid identity
				// instead of a 302 (browsers don't follow cross-protocol
				// redirects on fetch — a 302 → HTML login page surfaces in the
				// app as "Failed to load"). When EnvMockAuthAs is set (journey
				// tests), that role wins so RPCs run as the intended identity;
				// otherwise DefaultRole. Do NOT persist it as a cookie: writing
				// a default from a middleware fallback clobbers an explicit role
				// the user picked at /__ark/mock-login the instant any single
				// request races in without the cookie (common in the
				// cross-origin preview iframe, where the session cookie is
				// Partitioned). Only an explicit login (or EnvMockAuthAs)
				// authenticates whoami; with neither, the probe still 401s and
				// routes the user to the picker.
				if roleName = mockAutoLoginRole(cfg); roleName == "" {
					roleName = cfg.DefaultRole
				}
			}

			role, ok := cfg.Roles[roleName]
			if !ok {
				// Cookie refers to a role that was deleted from roles.json
				// since the session was created. Clear it and start over —
				// the next request will auto-assign DefaultRole above.
				clearSessionCookie(w)
				redirectToLogin(w, r)

				return
			}

			// Desktop personalizes the identity to the real local OS user
			// (ADR-0033); off-desktop this is the role's configured mock identity.
			// Mint the same `Authorization: Bearer <OIDC token>` UDS forwards in
			// prod, with this role's group paths, so the app decodes it identically.
			setMockBearer(r, role)

			next.ServeHTTP(w, r)
		})
	}
}

func setMockBearer(r *http.Request, role RoleDefinition) {
	name, username, email := mockIdentityFor(role)
	r.Header.Set("Authorization", "Bearer "+mintDevToken(username, email, name, role.Mock.UDSID, role.Groups))
}

// redirectToLogin sends a 302 to the mock login page with `return=` set
// so the user lands back where they started after picking a role.
func redirectToLogin(w http.ResponseWriter, r *http.Request) {
	returnTo := r.URL.RequestURI()
	if !isSafeReturnPath(returnTo) {
		returnTo = "/"
	}
	loginURL := mockLoginPath + "?return=" + url.QueryEscape(returnTo)
	http.Redirect(w, r, loginURL, http.StatusFound)
}

// isSafeReturnPath guards the login return path against open-redirect:
// only same-origin absolute paths are allowed. Rejects empty strings,
// protocol-relative URLs (//evil.com), and backslash-smuggling.
func isSafeReturnPath(p string) bool {
	if p == "" {
		return false
	}
	if !strings.HasPrefix(p, "/") {
		return false
	}
	if strings.HasPrefix(p, "//") || strings.HasPrefix(p, "/\\") {
		return false
	}

	return true
}

// cleanReturnPath validates + defaults a user-supplied return path.
func cleanReturnPath(p string) string {
	if isSafeReturnPath(p) {
		return p
	}

	return "/"
}

// readSessionCookie extracts the role name from ark_session. Returns "" if
// the cookie is absent or malformed.
func readSessionCookie(r *http.Request) string {
	c, err := r.Cookie(mockSessionCookie)
	if err != nil || c.Value == "" {
		return ""
	}

	return c.Value
}

// crossOriginIframePreview reports whether the preview is embedded as a
// CROSS-ORIGIN iframe in the wizard — the legacy browser-dev workflow — which
// needs the CHIPS cookie partition trick to survive third-party storage. Opt in
// with ARK_PREVIEW_IFRAME=1. The DEFAULT (incl. the desktop native window) is
// the first-party shape below.
func crossOriginIframePreview() bool {
	return os.Getenv("ARK_PREVIEW_IFRAME") == "1"
}

// sessionCookie builds the ark_session cookie. Dev-only (mock auth is off in
// production UDS, where Keycloak/Istio handle auth same-origin at ingress).
// Two shapes:
//
//   - Default — FIRST-PARTY: a plain, http-settable SameSite=Lax cookie. This is
//     what the desktop shell's native preview window (a top-level window on the
//     preview's own origin) needs — WKWebView refuses `Secure` cookies over
//     http://localhost and ignores Partitioned/CHIPS, so the CHIPS shape never
//     sets there and the mock login loops on 401.
//
//   - ARK_PREVIEW_IFRAME — CROSS-ORIGIN iframe (browser dev): the CHIPS shape
//     (SameSite=None + Secure + Partitioned) so the cookie lives in the iframe's
//     partition. Chrome honors `Secure` over http on localhost.
func sessionCookie(roleName string, maxAge int) *http.Cookie {
	c := &http.Cookie{
		Name:     mockSessionCookie,
		Value:    roleName,
		Path:     "/",
		HttpOnly: true,
		MaxAge:   maxAge,
	}
	if crossOriginIframePreview() {
		c.Secure = true
		c.SameSite = http.SameSiteNoneMode
		c.Partitioned = true
	} else {
		c.SameSite = http.SameSiteLaxMode
	}

	return c
}

// setSessionCookie writes the ark_session cookie.
func setSessionCookie(w http.ResponseWriter, roleName string) {
	http.SetCookie(w, sessionCookie(roleName, mockSessionMaxAge))
}

// clearSessionCookie removes ark_session. Must mirror setSessionCookie's
// attributes so the browser matches and expires the right cookie.
func clearSessionCookie(w http.ResponseWriter) {
	http.SetCookie(w, sessionCookie("", -1))
}
