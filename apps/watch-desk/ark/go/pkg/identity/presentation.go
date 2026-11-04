package identity

import "context"

// Current returns the request identity for application transport adapters.
// Missing middleware retains the historical unknown/user response, not an
// authenticated identity or a grant of permissions.
func Current(ctx context.Context) Identity {
	id := FromContext(ctx)
	if id == nil {
		return Identity{Username: "unknown", Role: "user"}
	}
	result := *id
	result.Groups = append([]string(nil), id.Groups...)
	return result
}

// RoleDescription is transport-independent application role metadata.
type RoleDescription struct {
	Name        string
	Description string
}

// Descriptions returns configured roles in the same order as RoleNames.
func (c *RoleConfig) Descriptions() []RoleDescription {
	names := c.RoleNames()
	roles := make([]RoleDescription, 0, len(names))
	for _, name := range names {
		roles = append(roles, RoleDescription{Name: name, Description: c.Roles[name].Description})
	}
	return roles
}
