# Ark Go Framework Reference

This bundled dependency provides application startup, ConnectRPC registration,
identity, storage, and River background jobs. Consume its APIs from application
code; treat this directory as read-only in a generated application.

## Extension points

- [Application](ark.go) composes the server, storage, services, and workers.
  [Startup](application_startup.go) owns database lifecycle, roles, identity
  middleware, seeding, and shutdown. The app supplies its ENT constructor,
  embedded frontend, and service registrations through `ApplicationOptions`.
- [Service interface](pkg/connectrpc/service.go) defines `ServiceRegistrar`
  and `BaseService`. [ServiceRegistry](service_registry.go) collects application
  initializers without a framework-global registry. In the application, follow `internal/service/registry.go`
  and an existing service's `init()` registration to add a ConnectRPC service.
  Pass `connectrpc.HandlerOptions(...)` to generated handlers to enforce the
  shared decoded-request limit before validation, including compressed messages.
- [Identity](pkg/identity/identity.go) exposes the request identity;
  [current user](pkg/identity/currentuser.go) maps it to an application user.
  [Role configuration](pkg/identity/config.go) defines application roles;
  [transport adapters](pkg/identity/presentation.go) supply identity and role
  values without importing application-generated RPC types.
- [Storage](pkg/storage/storage.go) and its [interfaces](pkg/storage/interfaces.go)
  expose the database and queue APIs. Use the framework's River integration
  for background work, including scheduled work, rather than raw ticker loops.

## Application changes

Define RPCs in the application's `proto/` directory and persistence models in
`ent/schema/`. Regenerate after either changes; follow the application's
`docs/ark-handoff.md` for codegen prerequisites and commands. Do not edit
generated protobuf, Connect, or ENT implementations.

Keep domain handlers in `internal/service/`. Map raw ENT errors through the
application's `internal/enterrors` at the RPC handler boundary. Pass contexts
through database and network calls, respect cancellation in loops, and check
numeric bounds before narrowing casts.

Production identity comes from the upstream authenticated JWT boundary.
Application features consume that identity and enforce their role checks;
they do not implement another login flow. The framework's mock identity mode
is for an isolated local development environment only.

Ark owns [domain error sanitization](pkg/connectrpc/errors.go). The app
classifies errors from its generated ENT client and delegates wire-safe mapping.
The [production wiring checker](pkg/archcheck/production.go) runs against the
app root through `go run github.com/defenseunicorns/ark/framework/go/cmd/archcheck`.
Application architecture tests may delegate to it; canonical pipeline enforcement
does not depend on those workspace-owned tests.
