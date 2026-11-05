# OTIS — Operational Tasking Integration System

**Keeping the Watch.** OTIS organizes naval message traffic into operational
tasking and timelines. The [mascot and artwork guide](docs/branding/otis/README.md)
contains the approved otter mascot, original artwork, and asset usage notes.

This application is imported into the Parse Command repository at
`apps/watch-desk/`. Run the commands below from **this application directory**.
For the combined Docker Compose stack, use the monorepo root README and
[integration guide](../../docs/integration/ark-export.md). The Go service is
retained for now; the [team decision record](../../docs/decisions/0001-retain-watch-desk-go-service.md)
tracks the later architecture choice. Original approved UI context remains in
`.ark-handoff/`. The reference OPTASK test payloads remain local-only; restore
them from the source archive using the root guide if needed.

This repository contains a Go application with an embedded React UI, ConnectRPC
services, ENT persistence, and bundled Ark framework libraries in `ark/`.
The Go module replacement and Bun workspace already select those local
libraries; there is no separate framework package to install.

See [local development and source handoff](docs/ark-handoff.md) for prerequisites,
build and test commands, code generation, and the meaning of exported project
context. Coding assistants should start with [AGENTS.md](AGENTS.md).

The [OTIS UI brand kit](docs/brand-kit.md) documents the Haze Gray, Maritime Dark,
and Vice appearances, typography, naval identity elements, and shared components.

Run these commands from the repository root after completing the documented
prerequisites:

```bash
bun install --frozen-lockfile
ark run job build
ark run stage tests
ark run stage checks
```

Application-specific setup and deployment requirements belong in this README
as the application evolves. Consult the included license files for applicable
terms.

## OTIS data source

Ship schedules currently use persisted, explicitly fictional USS Meridian
examples, not an operational backend or validated USMTF. See
[source data and integration notes](docs/source-data.md) for startup, empty-data
configuration, the shared read RPC, evidence semantics and verification.
