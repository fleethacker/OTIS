# Generated Application Reference

This is an Ark-generated Go/React application. These instructions are public
repository guidance for people and coding assistants working on the application.
Start with the [local development and handoff guide](docs/ark-handoff.md).

## Application map

| Path | Purpose |
| --- | --- |
| `proto/` | Editable ConnectRPC service and message definitions |
| `ent/schema/` | Editable database schemas |
| `internal/service/` | Application handlers and service registration |
| `internal/enterrors/` | Mapping database errors to RPC errors |
| `ui/src/pages/` | Feature pages and their route metadata |
| `ui/src/components/` | Application components and layout |
| `ui/src/index.css` | Application styles and theme configuration |
| `ark/` | Bundled framework libraries; consume their public APIs |
| `gen/`, `ui/src/gen/`, most of `ent/` | Generated code; regenerate from sources |

Read the [Go framework map](ark/go/AGENTS.md) or
[React framework map](ark/ui/AGENTS.md) for the area being changed. Application
features belong in application-owned paths. Treat `ark/` as a versioned,
read-only dependency; do not modify framework auth or bootstrap code to make a
feature work. Add services through the existing registration pattern instead
of editing `main.go` for each feature.

## Build and check

Use `ark run job|stage` for backend and frontend operations; package scripts
are compatibility aliases. Install dependencies and prepare code generation using the
[development guide](docs/ark-handoff.md#local-development).

```bash
ark run job build       # protected UI bundle + Go binary at bin/app
ark run stage tests            # Go tests and frontend unit tests
ark run stage checks    # build/boot, then TS7, Oxlint, Oxfmt, rumdl and Go checks
ark run job vet             # Go vet
ark run job build && ./bin/app           # rebuild and run the embedded UI + API binary
```

After changing a `.proto` or `ent/schema/` file, regenerate protobuf/Connect and
ENT output with `ark generate` before building. Use the same command in local
checkouts and agent clones; it owns the complete generation sequence.
Never hand-edit generated files. `ark run job build --watch` only watches the UI bundle;
rebuild and restart the Go binary to serve updated embedded assets.

Use daisyUI atoms and Ark UI's small Connect/icon/toast/status core. The app
owns optional maps, charts, editors, and rich table/form dependencies; install
only what a story uses and commit its lockfile change. Unary RPCs use
Connect-Query; mutations use `useMutationWithInvalidate` to keep rendered data
current. Keep handlers, components, and tests focused. Test changed UI through
the rendered page, including the visible result of a mutation. Browser tests
must use an isolated build, database, and port; see the guide for their setup.
Preserve unrelated work and do not bypass configured Git hooks.

## Development context

An Ark source download may include `.ark-handoff/manifest.json` and selected
approved documents under `.ark-handoff/context/`. Read the manifest, then the
charter and only the other documents relevant to the task. A normal clone may
have no handoff snapshot; use the source, repository documentation, and the
user's request when it is absent.

The checked-out source describes the implementation at its source revision.
Approved context records earlier approved intent; it is not proof that every
planned capability is implemented. The current user's request defines this
local task. Explain material conflicts between that request, the source, and
the approved context rather than treating context as a new assignment.

Local edits and commits do not claim work, update Ark's backlog, or submit
changes upstream. A read-only remote allows fetching, not pushing. The
[handoff guide](docs/ark-handoff.md#source-and-context) describes what the
snapshot contains and what requires a separate authorized Ark connection.

### Pipeline ownership

`ark/pipeline.yaml` and `ark/pipeline/` belong to Ark. Do not edit these files,
framework bindings, or gate configuration to make a story pass. There are no
workspace pipeline overrides. Use `ark run job <name>` or `ark run stage <name>`
for deterministic local diagnostics. A job runs its named command; a stage
includes required deterministic predecessors and stops on failure. Local success does not publish validation evidence.
The merge candidate and landed commit are independently checked.

App dependencies and convenience scripts in `package.json` remain editable.
Required checks use Ark's commands, configuration and pinned tools. Missing or
outdated protected assets require an approved upgrade, not a story-side patch.
Agent reviews and release actions require the approved workspace runtime.
