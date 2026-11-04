package ark

import "github.com/defenseunicorns/ark/framework/go/pkg/identity"

// ServiceDeps contains the framework dependencies supplied to app services.
type ServiceDeps struct {
	App   *Application
	Roles *identity.RoleConfig
}

// ServiceRegistry gathers application service initializers before startup.
// Each application owns its registry; registrations do not leak between apps.
type ServiceRegistry struct {
	initializers []func(ServiceDeps)
}

// Register adds an initializer, conventionally from an application init function.
func (registry *ServiceRegistry) Register(initialize func(ServiceDeps)) {
	registry.initializers = append(registry.initializers, initialize)
}

// InitAll registers the application's services in their registration order.
func (registry *ServiceRegistry) InitAll(deps ServiceDeps) {
	for _, initialize := range registry.initializers {
		initialize(deps)
	}
}
