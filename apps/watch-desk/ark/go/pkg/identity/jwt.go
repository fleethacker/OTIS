package identity

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"os"
	"strings"
	"unicode"
)

const subjectClaim = "sub"

// EnvIdentityClaim selects the ownership claim: unset or "sub" uses the local
// subject; "uds_id" requires the protected brokered claim without fallback.
// Unknown values deny identity resolution.
const EnvIdentityClaim = "ARK_IDENTITY_CLAIM"

// jwt.go reads the user's identity from the forwarded OIDC token — the
// production (UDS) contract.
//
// In UDS, an app protected with Authservice SSO is NOT handed oauth2-proxy-style
// X-Auth-Request-* headers. Instead the UDS operator installs an Istio
// RequestAuthentication with `forwardOriginalToken: true`, so after Authservice
// completes the OIDC handshake the app receives the Keycloak ID token as
// `Authorization: Bearer <jwt>`. This decoder requires a verification boundary
// on EVERY route into the receiver. SSO protection at an exposed gateway does
// not prove that internal workload or peer routes validated the token.
//
// This package only decodes claims. Ark's hosted portal and authority install
// internal/hostedidentity before this middleware to verify signature, issuer,
// audience and expiry at each receiver. Other consumers must supply their own
// verified upstream boundary; being in-mesh alone is insufficient.

// bearerClaims are the OIDC ID-token claims Ark maps to an Identity. Keycloak in
// UDS populates all of these; `groups` arrives as full paths (e.g.
// "/UDS Core/Admin") which feed RoleConfig.ResolveRole unchanged.
type bearerClaims struct {
	PreferredUsername string   `json:"preferred_username"`
	Email             string   `json:"email"`
	Name              string   `json:"name"`
	Groups            []string `json:"groups"`
	Subject           string   `json:"sub"`
	// Keep the custom claim raw so sub mode can ignore it, including values
	// with an unexpected JSON type. uds_id mode validates it below.
	UDSID json.RawMessage `json:"uds_id"`
}

// identityFromBearer resolves an Identity from the request's forwarded OIDC
// token, or nil when there is no usable bearer token. The role is derived from
// the token's group paths via the app's RoleConfig.
func identityFromBearer(r *http.Request, cfg *RoleConfig) *Identity {
	claims := decodeBearerClaims(r.Header.Get("Authorization"))
	if claims == nil {
		return nil
	}
	subject := claims.ownerSubject()
	if subject == "" {
		return nil
	}
	// Username is display metadata, never an ownership key. Fall back to the
	// local subject when the provider omits preferred_username and email.
	username := firstNonEmpty(claims.PreferredUsername, claims.Email, claims.Subject)
	return &Identity{
		Subject:  subject,
		Name:     claims.Name,
		Username: username,
		Email:    claims.Email,
		Groups:   claims.Groups,
		Role:     cfg.ResolveRole(claims.Groups),
	}
}

// ownerSubject uses only the deployment-selected claim from the verified token.
// Missing or malformed required claims fail closed, without switching IDs.
// The issuer must reserve uds_id for a trusted identity source and prevent
// users from editing it. Signature validation alone cannot enforce that rule.
func (claims *bearerClaims) ownerSubject() string {
	if !validSubject(claims.Subject) {
		return ""
	}
	switch os.Getenv(EnvIdentityClaim) {
	case "", subjectClaim:
		return claims.Subject
	case "uds_id":
		var subject string
		if json.Unmarshal(claims.UDSID, &subject) == nil && validSubject(subject) {
			return subject
		}
	}
	return ""
}

func validSubject(subject string) bool {
	return subject != "" && len(subject) <= 256 && strings.IndexFunc(subject, func(r rune) bool {
		return unicode.IsSpace(r) || unicode.IsControl(r)
	}) == -1
}

// decodeBearerClaims extracts the claim set from a "Bearer <jwt>" Authorization
// header WITHOUT verifying the signature (the caller must enforce the verified
// boundary described above). Returns nil for a missing/malformed token.
func decodeBearerClaims(authHeader string) *bearerClaims {
	const prefix = "bearer "
	if len(authHeader) <= len(prefix) || !strings.EqualFold(authHeader[:len(prefix)], prefix) {
		return nil
	}
	token := strings.TrimSpace(authHeader[len(prefix):])

	// A JWT is header.payload.signature; the claims live in the middle segment,
	// base64url-encoded without padding.
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return nil
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil
	}
	var claims bearerClaims
	if json.Unmarshal(payload, &claims) != nil {
		return nil
	}
	return &claims
}

// firstNonEmpty returns the first non-empty string, or "".
func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}

// mintDevToken builds the stand-in OIDC token the dev MockAuthservice forwards —
// the local analog of "Keycloak issued + Istio validated + forwarded". It uses
// the SAME claim names Keycloak emits so the app's decode path is identical in
// dev and prod. It is intentionally UNSIGNED (alg "none"): the dev path has no
// mesh to verify a signature, and the resolver decode-and-trusts in-mesh anyway.
// Never use this outside dev mock mode.
func mintDevToken(username, email, name, udsID string, groups []string) string {
	if groups == nil {
		groups = []string{}
	}
	claims := map[string]any{
		subjectClaim:         username,
		"preferred_username": username,
		"email":              email,
		"name":               name,
		"groups":             groups,
	}
	if udsID != "" {
		claims["uds_id"] = udsID
	}
	return encodeJWT(claims)
}

// encodeJWT base64url-encodes a header.payload.signature string from the given
// claims. The signature is a fixed placeholder — this is only for the unsigned
// dev token (see mintDevToken); production tokens come from Keycloak.
func encodeJWT(claims map[string]any) string {
	enc := func(v any) string {
		b, _ := json.Marshal(v)
		return base64.RawURLEncoding.EncodeToString(b)
	}
	header := enc(map[string]string{"alg": "none", "typ": "JWT"})
	return header + "." + enc(claims) + ".dev"
}
