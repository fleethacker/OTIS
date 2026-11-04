package identity

import (
	"os"
	"strings"
)

// EnvLocalUser / EnvLocalUserName let the desktop shell assert the real local
// OS user as the identity — the dev analog of Keycloak claims arriving via
// Authservice in K8s. The shell reads the OS user once and passes the short
// username (EnvLocalUser) and display/RealName (EnvLocalUserName); the mock-auth
// pipeline then renders the actual person instead of a generic dev-user, so the
// Account chip shows who's really there. See ADR-0033. Unset off-desktop
// (browser dev, journey tests, prod), where the role's configured mock identity
// (or real Authservice) applies unchanged.
const (
	EnvLocalUser     = "ARK_LOCAL_USER"
	EnvLocalUserName = "ARK_LOCAL_USER_NAME"
)

// mockIdentityFor returns the display name, username, and email to present for
// a selected role, applying the desktop local-user override when the shell
// provides it. Without the override, the configured username is also the best
// available display name.
func mockIdentityFor(role RoleDefinition) (name, username, email string) {
	username, email = role.Mock.Username, role.Mock.Email
	name = username

	short := strings.TrimSpace(os.Getenv(EnvLocalUser))
	if short == "" {
		return name, username, email
	}

	username = short
	if localName := strings.TrimSpace(os.Getenv(EnvLocalUserName)); localName != "" {
		name = localName
	} else {
		name = short
	}
	email = short + "@localhost"

	return name, username, email
}
