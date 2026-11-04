package identity

import (
	"encoding/json"
	"fmt"
	"maps"
	"os"
	"slices"
)

// RoleConfig defines the mapping from Keycloak groups to app roles
// and provides mock identities for dev/preview mode.
type RoleConfig struct {
	// Roles maps role name → role definition.
	Roles map[string]RoleDefinition `json:"roles"`

	// DefaultRole is used when no group matches. Falls back to the first role alphabetically.
	DefaultRole string `json:"default_role"`

	// sortedNames caches role names sorted for deterministic iteration.
	sortedNames []string
}

// RoleDefinition describes a single app role.
type RoleDefinition struct {
	// Groups are the Keycloak group paths that map to this role (e.g., ["/admin"]).
	Groups []string `json:"groups"`

	// Mock is the identity used in dev/preview mode when this role is selected.
	Mock MockIdentity `json:"mock"`

	// Description is a human-readable explanation shown in the RoleSwitcher.
	Description string `json:"description"`

	// Priority controls which role wins when a user belongs to multiple groups.
	// Higher number = higher priority. Defaults to 0.
	Priority int `json:"priority"`
}

// MockIdentity is the fake identity used in dev mode for a role.
type MockIdentity struct {
	Username string `json:"username"`
	Email    string `json:"email"`
	// UDSID simulates a protected Keycloak user attribute in mock mode only.
	UDSID string `json:"uds_id,omitempty"`
}

// DefaultConfig returns a zero-config RoleConfig with a `user` and
// `platform_admin` role. Used when no roles.json exists — the app
// works without any role configuration, and UI that gates on
// `platform_admin` is reachable from the preview by picking that role
// at /__ark/mock-login. Apps with more nuanced role needs ship a
// roles.json that fully replaces this config.
func DefaultConfig() *RoleConfig {
	cfg := &RoleConfig{
		Roles: map[string]RoleDefinition{
			"user": {
				Groups:      []string{},
				Mock:        MockIdentity{Username: "dev-user", Email: "dev@localhost"}, // arkstub:allow — dev mock-auth identity for the local preview; prod auth is UDS/Keycloak at ingress, not a stand-in stub.
				Description: "Default user",
			},
			"platform_admin": {
				Groups:      []string{"/platform-admin"},
				Mock:        MockIdentity{Username: "dev-admin", Email: "admin@localhost"}, // arkstub:allow — dev mock-auth identity for the local preview; prod auth is UDS/Keycloak at ingress, not a stand-in stub.
				Description: "Platform administrator — sees admin-only UI",
				Priority:    10,
			},
		},
		DefaultRole: "user",
	}
	cfg.sortedNames = []string{"platform_admin", "user"}
	return cfg
}

// LoadConfig reads a roles.json file and returns a RoleConfig.
// If the file does not exist, returns DefaultConfig (no error).
func LoadConfig(path string) (*RoleConfig, error) {
	// #nosec G304 -- Application startup selects the roles configuration file, not request input.
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return DefaultConfig(), nil
		}
		return nil, fmt.Errorf("reading roles config: %w", err)
	}

	return ParseConfig(data)
}

// ParseConfig loads validated role configuration from embedded or externally supplied JSON.
func ParseConfig(data []byte) (*RoleConfig, error) {
	var cfg RoleConfig
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("parsing roles config: %w", err)
	}

	if len(cfg.Roles) == 0 {
		return DefaultConfig(), nil
	}

	// Cache sorted role names for deterministic behavior.
	cfg.sortedNames = slices.Sorted(maps.Keys(cfg.Roles))

	// Default to first role alphabetically if not specified.
	if cfg.DefaultRole == "" {
		cfg.DefaultRole = cfg.sortedNames[0]
	}

	return &cfg, nil
}

// ResolveRole maps a set of Keycloak groups to the highest-priority app role.
// Returns DefaultRole if no group matches any role.
func (c *RoleConfig) ResolveRole(groups []string) string {
	groupSet := make(map[string]bool, len(groups))
	for _, g := range groups {
		groupSet[g] = true
	}

	bestRole := ""
	bestPriority := -1

	for name, def := range c.Roles {
		for _, g := range def.Groups {
			if groupSet[g] {
				if def.Priority > bestPriority || (def.Priority == bestPriority && name < bestRole) {
					bestRole = name
					bestPriority = def.Priority
				}
				break
			}
		}
	}

	if bestRole == "" {
		return c.DefaultRole
	}
	return bestRole
}

// MockIdentityForRole returns the mock identity for the given role name.
// Returns the default role's mock identity if the role is not found.
func (c *RoleConfig) MockIdentityForRole(roleName string) *Identity {
	def, ok := c.Roles[roleName]
	if !ok {
		def = c.Roles[c.DefaultRole]
		roleName = c.DefaultRole
	}
	return &Identity{
		Name:     def.Mock.Username,
		Username: def.Mock.Username,
		Email:    def.Mock.Email,
		Groups:   def.Groups,
		Role:     roleName,
	}
}

// RoleNames returns all defined role names in sorted order.
func (c *RoleConfig) RoleNames() []string {
	return c.sortedNames
}
