# Ark integration validation

Run date: 2026-11-04. Host: macOS arm64. Linux containers: arm64.

These are local integration diagnostics. Exported historical Ark validation
claims are not substituted for this run.

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

The Rust source was not changed. Cargo/rustfmt are absent on this host; the Rust
type-generation check cannot run because its rustfmt executable is unavailable.
No Rust test, clippy, format or regeneration success is claimed for this turn.

## Scope of confidence

The checks cover imported unit/contract behavior, packaging and local startup.
They do not validate operational USMTF interpretation, SME acceptance, production
identity/marking policy, hybrid search, embedding inference, mail ingestion,
retention, multi-architecture images or a real OpenSearch-backed schedule read.
Those capabilities are explicitly tracked in the integration analysis.
