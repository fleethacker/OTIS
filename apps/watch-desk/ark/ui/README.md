# Ark React framework

This bundled package provides Connect-Query hooks/providers, core icons,
notifications, and status components. The application root's Bun workspace
already resolves `@defense-unicorns/ark-ui` to this directory.

Ark also owns auth-session preflight and route validation. `AuthGate` protects
the initial mount, and `useIdentityState` observes session changes while the app
binds its generated identity query. `discoverRoutes` validates and orders the
app's generated page-module map. Keep application descriptors, pages, metadata,
and layout in application source; consume these APIs through its small local
bindings when useful.

Use daisyUI classes for buttons, inputs, cards, and other atomic UI. Import
core components and hooks from `@defense-unicorns/ark-ui`; the
[public exports](src/index.ts) define what is available. Rich libraries are
chosen and installed by the app that needs them.

See [the React framework reference](AGENTS.md) for application extension points,
data fetching, mutation invalidation, and UI conventions. Application setup and
test commands live in the application's `docs/ark-handoff.md`.
