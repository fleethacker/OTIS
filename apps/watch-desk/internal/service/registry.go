// Package service implements the application's ConnectRPC services.
package service

import ark "github.com/defenseunicorns/ark/framework/go"

// ServiceDeps preserves the application's service registration contract.
type ServiceDeps = ark.ServiceDeps

var services ark.ServiceRegistry

func registerService(initialize func(ServiceDeps)) { services.Register(initialize) }

// InitAll connects this application's registered services to Ark startup.
func InitAll(deps ServiceDeps) { services.InitAll(deps) }
