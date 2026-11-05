# Rust integration validation — 2026-11-04

Implemented on `codex/rust-frontend-integration`. The running local stack uses
Rust for application APIs and continuous publication; React is served through a
static/proxy container. Go is not part of the active runtime. The separate
SMTP/IMAP demo and all original volumes were preserved.

## Checks completed

- Rust workspace tests, formatting, Clippy with warnings denied, and generated
  storage types checked against their source schema. Container Linux workspace
  tests use the pinned Rust compiler.
- Seven new Rust tests cover private owner/revision isolation, reopen behavior,
  revocable sessions, strict preparation validation, timestamp/point semantics,
  complete/idempotent migration, and the real generated JSON ConnectRPC router.
- Protected UI type/lint/format checks and 47 UI tests pass, with one optional
  external-corpus test skipped. No Ark framework/pipeline/generated TypeScript
  file was modified. The compatible Ark CLI is not installed, so canonical
  `ark run` orchestration itself was not run; the bundled protected tools and
  portable Docker diagnostic targets were used.
- Root and compatibility Compose configurations validate. Real HTTP tests pass
  for identity, canonical browsing, detail, lazy audit evidence, draft/preparation
  reads, all search API modes, timeline, status and explicit legacy API reads.
- Browser verification confirms indexed messages, selected structured content,
  private composer, and ranked hybrid search results. Both unrequested dropdowns
  were removed; the user confirmed automatic hybrid search for the existing
  search inputs.
- The read-only hybrid verification script checks BM25 + local semantic clauses,
  identical metadata filters, RRF `rank_constant=60`, descending rank, vector
  exclusion and actual reciprocal-rank score arithmetic against OpenSearch.
  It verified 2 keyword / 93 semantic / 93 fused passage results for its query.
  This verifies execution and fusion, not judged relevance improvement.
- The original backlog drained to 14 canonical messages, 92 ready passages and
  665 published audits with no outstanding publication jobs. A clearly synthetic
  local email then passed SMTP → IMAP → parsing → automatic publication → search
  and produced a point at its exact explicit source time. Its partial-time fact
  stayed unresolved. Replaying the identical body with a changed subject kept
  one canonical message, selected the newest subject and flagged the conflict.
- Final local totals are 15 canonical messages, 93 ready embedded passages and
  677 published audit records. This includes one constructed verification message
  and two email receipts for that body. Existing historical data was preserved.
- Consistent custody and legacy SQLite backups passed integrity checks. The real
  Go database migrated all five legacy messages. Synthetic migration tests
  exercise drafts owned by different accounts, generated content, activity,
  event revisions and unowned private rows. Restarting the replacement retains
  publication state and migrated data without reimporting or duplicating it.

The prior embedding validation also covered bounded Unicode chunking, explicit
inference failure preserving text, and cold deployment/inference/hybrid retrieval
while OpenSearch was disconnected from its application network. Those checks
preceded the application cutover and are recorded in the search runbook.
No new operational PKI/TLS/authentication certification, destructive cluster
recovery test, or large-burst capacity claim is implied.

An idle snapshot measured about 15.7 MiB for Rust and 2.0 MiB for the web proxy;
OpenSearch used about 1.8 GiB including native inference despite its 512 MiB JVM
heap. These are local observations on this small corpus, not sizing guarantees.
The server is capped at 256 MiB / one CPU and web at 32 MiB.

## Preserved rollback assets and remaining deployment work

Consistent backups and saved Go binaries live outside Git under
`/tmp/parse-command-cutover-20261104`. The recovered rollback image is
`parse-command/watch-desk-go-rollback:20261104`. The original image digest was
unresolvable by Docker, so the running static binaries were copied and packaged
into a separate rollback image. Original data volumes remain intact.
The [runbook](combined-stack.md) explains preserving new Rust private writes
before any rollback; restoring an old Go database cannot replace those writes.

Validation indices intentionally have no expiry so historical examples remain
available. Operational issue-time hot/cold retention, Exchange PKI/TLS and
operational user authentication remain deployment work. Runtime assets are
local; enclave network isolation must be enforced outside the ordinary bridge.
Raw/parsed sample data, manual-derived knowledge, model bytes, credentials,
SQLite backups and validation logs are not committed.
