# Parse Command repository guidance

Read `README.md`, `docs/README.md`, and `docs/integration/ark-export.md` first.
This repository combines the Rust parser foundation with an imported Ark Go/React
application. Current user instructions take precedence over historical planning
and the exported `.ark-handoff/context/` snapshot.

## Ownership and contracts

- `backend/`: Rust parser SDK, core host, OPTASK contributor, durable IMAP worker
  and tests. Follow `backend/README.md` and `backend/INTAKE.md`. Parsing remains
  transport independent and bounded; intake stages results in its custody journal.
- `apps/watch-desk/`: React UI plus the Go service that serves it and persists
  private drafts/preparations. Follow its `AGENTS.md` and `docs/ark-handoff.md`.
- `docs/ICD.md`, `docs/schemas/`, `docs/opensearch/`: shared parsed-data contracts.
  Schema changes start here; regenerate Rust types rather than editing generated
  types. The UI protobuf is a different presentation contract.
- `docker-compose.yml`: local UI/OpenSearch stack; `compose.intake.yml`: optional
  combined mail/intake overlay reusing `demo/` and `backend/` service definitions.
  `docs/integration/`: current analysis, export inventory and operating instructions.
- `.pdlc-docs/` and `.ark-handoff/context/`: retain both sets of product context.
  Historical proposals are not evidence of working implementation.

Treat `apps/watch-desk/ark/` as a read-only bundled dependency, including its
pipeline. Do not hand-edit generated ENT/protobuf/route-registry code. Use Ark
generation and checks for app changes. Docker packaging invokes the existing
bundled UI builder; it does not replace the canonical Ark validation pipeline.

Keep the raw/parsed OPTASK corpus and manual-derived knowledge outside Git.
Two imported reference fixtures are intentionally ignored; the original archive
retains them. See the integration guide for restoring optional tests. Never
commit source traffic, credentials, local databases, dependency caches or builds.

## Verification

From `backend/`, run the checks documented in its README after Rust changes.
From `apps/watch-desk/`, use `ark run job build`, `ark run job test-go`,
`ark run job test-ui`, and relevant checks/journeys with an isolated database.
The standalone Go module uses its local `ark/go` replacement; use `GOWORK=off`.
Validate Compose with `docker compose config --quiet`; build and smoke-test
container changes. Do not treat service health as proof of a working data adapter.
Validate both the base configuration and the optional `compose.intake.yml` overlay
after Compose changes. `docker build --target test backend` runs the Rust workspace
tests using the pinned container toolchain. Preserve separate UI, mail and custody
volumes; never remove them as a workaround for integration errors.

