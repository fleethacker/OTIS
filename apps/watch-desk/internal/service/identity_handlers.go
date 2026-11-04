package service

import (
	"context"

	"connectrpc.com/connect"
	"github.com/defenseunicorns/ark/framework/go/pkg/identity"
	appv1 "github.com/defenseunicorns/generated-app/gen/app/v1"
)

// GetIdentity adapts the framework's resolved identity to this app's RPC schema.
func (s *AppService) GetIdentity(ctx context.Context, _ *connect.Request[appv1.GetIdentityRequest]) (*connect.Response[appv1.GetIdentityResponse], error) {
	id := identity.Current(ctx)
	return connect.NewResponse(&appv1.GetIdentityResponse{
		Username: id.Username, Email: id.Email, Groups: id.Groups, Role: id.Role,
	}), nil
}

// ListRoles adapts configured role descriptions to this app's RPC schema.
func (s *AppService) ListRoles(_ context.Context, _ *connect.Request[appv1.ListRolesRequest]) (*connect.Response[appv1.ListRolesResponse], error) {
	descriptions := s.roles.Descriptions()
	roles := make([]*appv1.RoleInfo, 0, len(descriptions))
	for _, role := range descriptions {
		roles = append(roles, &appv1.RoleInfo{Name: role.Name, Description: role.Description})
	}
	return connect.NewResponse(&appv1.ListRolesResponse{Roles: roles}), nil
}
