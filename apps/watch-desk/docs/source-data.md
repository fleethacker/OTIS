# Watch Desk source data

## Inspection and source selection

Inspected `proto/app/v1/`, `internal/service/`, the domain schemas and README
at the starting source revision. Only starter health, metadata and identity RPCs
existed; no ship-event backend URL, credential binding or upstream contract was
present. The approved fictional-data option therefore applies. No external HTTPS
source is configured, and no `external-data.json` or credentials are needed.
There is no USMTF parser, upstream search connection, AI summary or transmission.

The running source is **persisted SQLite records**, not an in-handler fixture.
`ScheduleSource` in `internal/service/source_data_service.go` is the server-only
replacement seam. Production registration uses `persistedScheduleSource` with
the framework's ENT client. It never synthesizes data on read or falls back to
examples on error. Replace this adapter and the source metadata when a real
contract is supplied; never put upstream credentials in browser configuration.

## Startup

Follow `docs/ark-handoff.md` for toolchain setup. From the repository root:

```bash
ark run job build
ARK_DB_PATH=/absolute/path/to/watch-desk.db PORT=8080 ./bin/app
```

The existing framework seeder reads `internal/data/seed_data.json` after schema
initialization. It skips populated tables; this is initial data, not a refresh
or migration mechanism. Do not mix the fictional fixture with operational data.
Use a dedicated database and a source-appropriate seed override for integrations.
For a fresh **empty** run, point `ARK_DB_PATH` at a different new database and set
`ARK_SEED_PATH` to an existing JSON file containing:

```json
{"message_records":[],"extracted_events":[],"event_revisions":[],"draft_acknowledgements":[]}
```

Changing the seed path does not clear an existing database. The seeder logs
insertion problems as warnings: verify counts, not merely startup success.
JSON-valued SQLite columns in the keyed fixture use serialized JSON strings;
missing keys remain SQL NULL. `message_record_events` and
`extracted_event_revisions` are the actual generated foreign-key columns.

The fixture has **5 messages, 8 events, 1 revision, 0 drafts**. It includes three
short same-day events (two overlap), a 54-hour exercise, midnight and month-end
crossings, a revised schedule with unknown prior end, and an unresolved event
without times/location. All messages explicitly carry fictional provenance and
raw-text disclaimers. Fixed November 2026 dates are illustrative, not a rolling
operational feed or a promise that events will always be upcoming.

## Consumer contract

`app.v1.SourceDataService/ReadSchedules` accepts `{}` and returns a complete,
deterministically ordered message snapshot with nested events and revisions.
Generated Go and Connect-Query clients are produced by `ark generate`.
Message `id` and event `id` are stable database keys; `source_message_id` retains
source identity. Each event has `message_id`; each revision has `event_id`.
Multiple events may reference one message. Draft read/write behavior is separate
feature work; this read does not load drafts.

Supported evidence: raw text, optional subject/sender/received time, optional
recipient wrapper, processing status, per-message provenance, unit/location,
optional absolute times, schedule status/review reason, revision history and
one-based source-line references. A missing wrapper means unavailable; present
empty arrays mean known empty. Partial revision times remain individually absent.
Timestamps are serialized as UTC instants. Consumers must require confirmed
status, both times and end after start before drawing a timed event. Do not
interpret absent times or locations as confirmed values.

Each invocation reads the database anew. There is no timer, polling, adapter
cache or fallback. `retrieved_at` is the successful server read time, **not** the
upstream extraction time or a guarantee of source currency. `source` identifies
persisted storage, and `notice` explains example limitations. Inspect each
message's provenance even in an empty or mixed dataset. A read failure returns
Connect `Unavailable` with no success envelope or fresh timestamp; no database
error details or credentials are returned. Consumers own their pending UI,
error UI and retry action. If retaining a prior snapshot while fetching, label
it as previously retrieved and never replace its freshness time until success.

## Optional message lifecycle integration

`MessageRecord.lifecycle_entries` is an optional JSON array stored on each source
record and exposed as `lifecycleEntries` by the generated client. Each entry has
`id` (nonempty, stable and unique within the message), `milestone` (nonempty open
vocabulary, such as `received`, `parsed`, `ingested`, `acknowledged` or `reviewed`),
optional `recorded_at` (RFC3339 timezone-aware instant), `detail` and `provenance`.
The latter two are optional strings; integrations should supply evidence origin.
For framework seed JSON, encode the array as a serialized JSON string, like the
other JSON-valued columns. Omitted fields remain compatible with older records.

The service preserves repeated milestones and details. Dated entries sort by
absolute instant, then stable ID lexically; undated entries follow, sorted by ID,
not as an assertion that they happened later. Consumers must label their time
unavailable. An absent/empty history is not evidence of a completed pipeline;
even a populated history can be partial. No universal completed sequence exists.
A real `received_at` supplies one `received` entry unless an explicit milestone
named Received (case-insensitive, surrounding whitespace ignored) has that exact
instant. Undated or differently dated Received entries remain separate evidence.
The fallback ID is `received_at`, with underscores appended if needed to avoid
supplied ID collisions. No other transition is inferred from current status,
database creation, schedule/revision times, or retrieval time.

History is shared, source-owned evidence only. Never insert private draft text,
owner identifiers, or draft-save activity into it. The shared serializer does not
load drafts; saving a draft neither changes lifecycle/status nor acknowledges or
transmits a message. Supplied acknowledgements are read-only external evidence.

The unchanged five-message fixture demonstrates rich fictional history on -001,
partial history with repeated milestones, tied times, a UTC day boundary and an
undated additional type on -004, received-only legacy records on -002/-003, and
no history or received time on -005. All supplied history is explicitly fictional:
these are illustrative entries, not actual upstream processing evidence. Existing
populated databases are not backfilled by the initial-data seeder.

## Optional structured message contract

`MessageRecord.structured_payload_json` is optional nullable **text**, exposed by
generated clients as `structuredPayloadJson?: string`. SQL NULL/protobuf absence
means legacy rendering. A present value must be a valid JSON object, including
`{}`; empty text, JSON null, arrays and scalars are not payload envelopes. ENT
writes and the service's replaceable adapter boundary validate this shape only.
Malformed adapter output fails the whole read as Unavailable, without a partial
snapshot. No field allowlist or type-specific schema drops future extensions.

The string is copied without parsing/re-encoding: whitespace, numeric spelling,
large numbers, duplicate keys, array order/IDs, nested unknown fields and
absent/null/empty/false/zero values survive persistence and generated RPCs.
Adapters must supply the original JSON object text, not protobuf Struct or a
typed projection. Consumers may parse a view but must retain the original string
and must not write a lossy JavaScript-number projection back as source content.
Payload `id` (including hashes) and `revision` are source metadata, separate from
numeric database keys, navigation `source_message_id` and event revision history.

`reference_attribution` is optional nullable text (`referenceAttribution?: string`)
and provenance now accepts `reference` alongside `upstream` and `fictional`.
Reference wrappers should identify the attachment name and immutable attachment
ID, and label reference/test-only use. Attribution is not authorization, validated
markings, or evidence that a real upstream integration exists. Payload issued and
expiry times never populate received time or lifecycle history. Periods and
activities do not create ExtractedEvents, ship ownership or calendar events.
Structured JSON is not original raw USMTF; leave unavailable raw text empty rather
than fabricate line references. No existing operational or startup seeds change.

All 14 attachments are retained in
`internal/service/testdata/structured-messages.json` as attributed wrappers with
`id`, `name`, `purpose` and the exact original `text` string. The adjacent
`generate.go` derives this fixture from the bound story manifest without changing
the originals; it is a developer generator, not an importer or startup task.
Service tests persist all 14 plus extension cases in isolated SQLite, reopen it,
read via the generated Connect client and verify byte-exact strings and optional
presence, including protobuf JSON round-trips. A legacy-schema migration test
checks old rows retain absent payloads. These checks do not verify live access.

## Proposed real integration expectations

A future real adapter needs a documented server-accessible endpoint/auth contract,
stable message and event IDs, timezone-aware timestamps and explicit incomplete
statuses. Preserve raw text and all available recipients, processing status,
revision values and supporting line references. Mark unavailable evidence absent,
not fabricated. Verify a real configured request and returned source identities;
unreachable sources must fail visibly without switching to fictional data.
Any HTTPS adapter must add `external-data.json` with the reachable URL and URL
environment variable, plus existing Secret references only if actually supplied.
No source credentials, production access, network prerequisites, deployment or
publication were supplied or performed in this story.

## Verification

`ark run job test-go` exercises the registered Connect handler over HTTP against
an isolated SQLite database populated by the framework seeder. It asserts counts,
links, provenance, evidence, missing values, boundary cases, repeat reads, restart
stability and failure after a successful read; it also covers empty reads and UTC
normalization. Built-binary startup was separately exercised with isolated
`ARK_DB_PATH` values and `ARK_SEED_PATH` overrides: the seeded RPC returned
FICTIONAL-MERIDIAN-001 through -005 and 8 events; the empty override returned
0 messages and 0 events. These are real persistence/RPC checks with fictional
content, not verification of an upstream service. UI surfaces belong to Calendar
and Message records stories; this backend story adds no screen.
