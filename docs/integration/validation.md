# Ark integration validation

Run date: 2026-11-04. Host: macOS arm64. Linux containers: arm64.

These are local integration diagnostics. Exported historical Ark validation
claims are not substituted for this run.

## Rebase verification after PR #2

Rebased PR #3 onto PR #2's merged `main` commit
`77d5267fe29589bb99a9ce3fc5020e37c4381ffb` on 2026-11-04. The backend README
conflict was resolved by retaining SDK 0.2.0 / ICD 1.1.0 and the imported app's
actual location. A local recovery branch,
`codex/ark-export-integration-before-rebase`, retains the original PR #3 head.

| Check | Result |
| --- | --- |
| Upstream preservation | Rust domain code, ICD 1.1.0 schemas and OpenSearch mappings match merged `main` |
| Base and combined Compose configuration | Passed; combined model has web, search, mail configuration, mail server and intake services |
| Overlay paths and network | Passed: backend/config and mail seed paths resolve from the repository root; no external network dependency remains in the combined model |
| Rust intake runtime image | Built successfully using the pinned backend Dockerfile |
| Rust workspace container tests | 48 passed, 0 failed, 2 external-corpus regressions intentionally ignored |
| Watch Desk runtime image | Rebuilt successfully |
| Go tests and vet | Passed after rebase |
| UI unit tests | 59 passed, 0 failed, including locally restored reference-rendering coverage |
| TypeScript checker | Passed |
| Combined-stack live startup | Not run: approval to start a separate smoke-test project was declined; no test messages were sent |
| Diff checks | Passed; no conflict markers or unintended Rust domain/contract edits |

The new optional overlay and Rust test target are described in
[the combined-stack guide](combined-stack.md). The default UI/search runtime
retains the original verified behavior below. Current build/configuration
checks do not establish a live SMTP-to-custody-to-search-to-calendar workflow:
continuous delivery and the UI adapter remain unimplemented. No new runtime
persistence claim replaces the earlier declined write/restart probe.

## Original import verification

| Check | Result |
| --- | --- |
| Archive safety/inventory | Passed: all 346 regular UTF-8 files inventoried, original hashes and destinations recorded |
| Export preservation | Passed: original bundled `ark/` files unchanged; original archive retained locally |
| Lock portability | Passed: application lock differs only in registry URL prefix; versions and integrity hashes unchanged |
| Corpus exclusion | Passed: archive and two reference payload files ignored by Git and excluded from Docker context |
| `docker compose config --quiet` | Passed |
| Host `GOWORK=off go test -count=1 ./...` | Passed, including locally restored external-reference coverage |
| Host `GOWORK=off go vet ./...` | Passed |
| Exported protected UI builder, invoked directly | Passed: generated routes, CSS and embedded JS assets |
| Host UI unit diagnostics with the exported toolchain | Passed: 59 tests, 0 failures, including all fourteen restored references |
| Clean Linux `ui-test` build target | Passed: 44 tests, 1 optional corpus test skipped, 0 failures; the fourteen per-reference cases are absent without the corpus |
| Exported TypeScript checker, invoked directly | Passed |
| Formatting of edited application TS files | Passed with the exported Oxfmt configuration |
| Linux runtime image | Passed: Go/React binary and shell-free health probe built into the nonroot runtime image |
| Clean Linux `go-test` target | Passed: Go tests and vet; one optional external-reference test explicitly skipped |
| Live Compose startup | Passed: web healthy; OpenSearch green; both loopback host ports reachable |
| Cross-container connectivity | Passed: OpenSearch container reached the read-only Go schedule RPC through `web:8080` |
| Live schedule and assets | Passed: five fictional messages, eight events, embedded JS/CSS and SPA route available |
| Browser rendering | Passed: actual Calendar rendered with schedule controls, fictional events, source links and unresolved review notice |
| Full container write/restart persistence probe | Not run: sandbox approval to write a synthetic search document and private unsent draft was declined; no such records were created |

The runtime image `parse-command/watch-desk:local` was built on Linux arm64:
manifest digest `sha256:0c9141e22191fc198f289ceb595cb208ec021c2956baf3e78093e2ec415e691a`,
65,492,119 bytes reported by Docker. The live web container ran as
`65532:65532` with a read-only root filesystem and its named data volume.
Startup persisted the fictional seed successfully. Go contract tests cover
SQLite reopening and draft behavior; this does not replace the declined
container-level write/restart probe.

The live checks used a separate Compose project, `parse-command-ark-smoke`, with
host ports 18080 and 19200 and separate named volumes. No default-project data
was changed. Test containers/network were removed after validation; its named
test volumes were retained. The normal local command remains
`docker compose up --build -d --wait` with ports 8080 and 9200.

## Toolchain limits

The installed Ark CLI identifies itself as `dev`. With its framework root set,
`ark run job build` rejects the export's protected assets with:

```text
verify required pipeline: ark-owned pipeline assets are missing or modified;
restore the approved files or upgrade the workspace:
ark/pipeline/journey-test/index.mjs
```

Those files match the archive exactly. The local CLI and exported protected
bundle are incompatible; no framework/pipeline file was changed to bypass that
check. Container packaging and direct pinned-tool diagnostics work independently
of that CLI, but do not constitute a successful canonical Ark pipeline run.
Install a CLI compatible with the handoff before claiming those checks or
running the full protected journey suite.

Bun 1.4.2 emits a nonfatal `directory mismatch` diagnostic for the supplied
TypeScript override during unit tests. The processes exit successfully with the
pass counts above. The tests also emit an existing JSX-transform warning. No
dependency version was changed to suppress these messages.

During the original import, Cargo/rustfmt were absent on this host, so no Rust
checks were completed then. The rebase verification above adds the pinned-container
workspace test run. Rust clippy, formatting, type regeneration and the two
opt-in external-corpus regressions were not rerun in this integration update.

## Scope of confidence

The checks cover imported unit/contract behavior, packaging and local startup.
They do not validate operational USMTF interpretation, SME acceptance, production
identity/marking policy, hybrid search, embedding inference, mail ingestion,
retention, multi-architecture images or a real OpenSearch-backed schedule read.
Those capabilities are explicitly tracked in the integration analysis.
