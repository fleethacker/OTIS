# Ark React Framework Reference

This bundled dependency is `@defense-unicorns/ark-ui`. Consume its public exports
from application code; treat this directory as read-only in a generated app.

## Components and data

- [Public exports](src/index.ts) are the available import surface.
- [Core exports](src/composites/index.ts) include notifications and status.
  Maps, charts, editors, rich tables/forms, and diff viewers are optional
  app-owned integrations, not bundled framework dependencies.
- [ConnectQueryProvider](src/providers/ConnectQueryProvider.tsx) supplies the
  RPC transport and query cache. Preserve the application's provider stack.
- [Mutation hook](src/hooks/useMutationWithInvalidate.ts) declares which queries
  a mutation invalidates. Use it so successful edits update the rendered page.
- [Auth lifecycle](src/auth/index.ts) owns session preflight and query-cache
  invalidation. The application's identity hook binds its own generated query
  descriptor to `useIdentityState`; account presentation remains app-owned.
- [Route policy](src/routes.ts) validates the application's generated page map
  through `discoverRoutes`. The app owns page components and metadata.
- [Streaming hook](src/hooks/useConnectStream.ts) and
  [client hook](src/hooks/useClient.ts) support generated streaming RPC clients.

Use `useQuery` with generated Connect-Query descriptors for unary reads.
Import core components, hooks, and icons from `@defense-unicorns/ark-ui`. Lucide
(`Lu*`) and Heroicons (`Hi*`) are exported; keep one primary icon family.

## Application UI

daisyUI supplies atomic classes such as `btn`, `input`, `card`, and `modal`.
Use semantic theme colors and Tailwind spacing utilities. Preserve the app's
theme and typography; avoid hardcoded product colors or layout spacing in JSX.

Feature pages live in the application's `ui/src/pages/`. Follow its
`ui/src/route-registry.ts` contract: each page exports a default component and
`route` metadata. The build regenerates `route-registry.generated.ts`; do not
edit that generated file. Application components and layout live in
`ui/src/components/`.

Handle loading, empty, and error states as part of the rendered experience.
Tests should exercise navigation and visible mutation results. Run the
application root's build, unit tests, and validation commands; consult its
`docs/ark-handoff.md` for isolated browser-test setup.
