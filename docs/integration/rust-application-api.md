# Rust application API

Current authentication, roles and persistence are defined in [Settings, OIDC and hidden state](settings-oidc.md). The parsed-message presentation contract below remains separate from application state.

The React app calls the same-origin Rust server through `web`. OpenSearch DSL,
index names, model IDs, passage grouping and search templates stay in Rust.
The browser does not receive vectors, credentials or arbitrary query access.
The parsed-message ICD 1.4.0 remains the contributor/storage contract.

## Reads

Send JSON to `POST /api/v1/messages/{operation}`. Unknown request/filter fields
are rejected. Requests are limited to 128 KiB, responses to 2 MiB, and application
reads to seven seconds. Failed or partial OpenSearch reads fail the request.
`Cache-Control: no-store` applies to API responses.

```json
{
  "query": "communications",
  "mode": "hybrid",
  "dataset": "canonical",
  "sort": "relevance",
  "filters": {
    "commandIds": [],
    "messageTypes": ["OPTASK COMMS"],
    "originators": ["TRAINING GROUP 99"],
    "classifications": [],
    "unassignedOnly": false,
    "noCommands": false
  }
}
```

| Operation | Inputs and result |
| --- | --- |
| `list` | Empty query, typed filters/sort, optional opaque `pageToken`; at most 20 metadata cards with count and previous/next page tokens |
| `search` | Nonempty query, `keyword`, `semantic` or `hybrid`; at most 20 message revisions per page from the fixed 100-passage ranked window |
| `options` | Canonical message-type and originating-command choices from bounded metadata aggregations (32 types / 256 originators) |
| `detail` | Exact `key`; selected full structured record and preserved raw body, receipt time, evidence availability |
| `timeline` | Explicit RFC3339 `from`/`to`, positive window up to 42 days; command filters and optional hybrid query; up to 100 source messages / 2,048 facts |
| `evidence` | Exact `key`, optional `factId` or `passageId`; separate bounded audit records |

List/search/detail/timeline return the existing protobuf JSON
`ReadSchedulesResponse` shape plus an application-owned `meta` object. The
shared adapter removes `meta` before decoding with the generated schema.
For canonical list/search results, `meta.messageHeaders` is keyed by the full
source message key and contains only optional `type`, `originator` and `issuedAt`
fields from the canonical document. Cards use the MSGID originator and issue
time; absent values stay unavailable. Subjects remain in each message's `subject`.
This header projection adds no per-message detail queries or raw/audit payloads.
Evidence returns `{messageKey, records, retrievedAt, state}`.
`GET /api/v1/source/status` reports cluster, model, passage embedding states and
publication job counts. HTTP liveness is separately available at `/api/health`.

Keys are the **full** canonical message ID plus `@revision`:
`sha256:<64 lowercase hex>@<revision>`. Local numeric protobuf IDs are persisted
UI aliases; they never replace source identity. Evidence and private state are
always scoped to the exact revision. Legacy keys have a separate `legacy:`
namespace. Legacy records only appear when `dataset: "legacy"` is explicitly
requested and fixture mode is enabled. There is no fixture fallback.

List/search accept `sort: relevance | issued_desc | issued_asc`. Browsing uses
newest issue time when relevance has no query; missing issue times sort last in
both date directions. Date ties use source ID and revision for stable ordering.
Sender filtering means exact MSGID originating commands (`filters.originators`),
not RFC email senders. The UI's issued-through date includes that entire day in the selected IANA timezone; the exclusive `issuedTo` instant is converted to UTC.

`meta` supplies `page`, `pageSize: 20`, `totalRecords`, `totalRelation`, optional
`totalPages`, and opaque `currentPageToken` / `previousPageToken` / `nextPageToken`.
Tokens bind the owner, query, mode, filters and sort. Any change starts a new
window. Browsing uses PIT plus `search_after`; counts are exact up to 10,000 and
then explicitly have relation `gte`. PIT keepalive is 120 seconds. Previous pages
reuse saved anchors in the same PIT, including after reaching the final page.

Hybrid search keeps an explicit `pagination_depth: 100` and deduplicates all of
that ranked passage window into message revisions before paging. Relevance order
comes from OpenSearch RRF. Date sorting applies to the complete deduplicated
window, not just the visible page. Counts describe **top matches in that ranked
window**, never the entire semantic match population. Continuation pages reuse
the ranked snapshot without model inference; `snapshotAt` identifies its time.
No continuation page enlarges the candidate depth or silently reranks messages.

Read-window state lives in ephemeral `read_window` records in the hidden
OpenSearch application-state index. It is limited to 64 windows, 512 KiB each, with 110-second idle
expiry renewed by active paging. It contains bounded metadata/excerpts or PIT
anchors, never vectors, raw email or audit payloads. Expired/mismatched windows
fail explicitly; retry starts a fresh search. They do not alter drafts or custody.

Filters support issue-time bounds `issuedFrom` inclusive / `issuedTo` exclusive,
up to 32 exact values in each metadata list, and unassigned-only selection.
Selected command IDs plus unassigned selection form a union. Unknown or empty
explicit command selections must not broaden to all commands. Participants and
originators are not assumed to be locally assigned command IDs.

Browsing cursors bind stable owner identity and filters. Expiry requires restarting browsing. Search preserves passage rank when
hydrating parents, validates IDs/revisions and filters again, and drops stale
parents. It claims no complete result count or global message-ranking metric.
`windowLimited` identifies a full candidate window. Empty queries use browsing,
not neural inference. Queries are at most 240 UTF-8 bytes. The frontend debounces
search by 300 ms, cancels superseded reads and polls visible source reads every
30 seconds. Hybrid/model failure is explicit; API callers can request keyword mode. The UI has no search-mode or dataset selector.
Only one neural/hybrid request runs per server, with eight total HTTP requests.

## Stored templates

Rust installs and calls these versioned templates after cluster health preflight:

| ID | Role |
| --- | --- |
| `parse-command-messages-list-v1` | Filtered PIT browsing; metadata only |
| `parse-command-message-detail-v1` | Exact message/revision lookup |
| `parse-command-timeline-v2` | Bounded activity and recurrence candidates for the UTC window |
| `parse-command-evidence-list-v1` | Revision/fact/kind-filtered audit paging |
| `parse-command-source-status-v1` | Embedding-state aggregation |
| `parse-command-passages-keyword-v2` | BM25 narrative/subject search |
| `parse-command-passages-semantic-v2` | Local MiniLM neural search, ready passages |
| `parse-command-passages-hybrid-v2` | Filtered BM25 + neural search, RRF pipeline |

The server supplies validated template parameters, not browser-provided DSL.
`publisher.rs::templates` owns their source. Older v1 passage templates remain
available to existing test tools; the application uses v2's larger candidate
window. The existing local ingest pipeline/model pins remain unchanged.

The recurrence-aware timeline uses v2. This server does not publish or replace
`parse-command-timeline-v1`, so older application instances can keep using v1
on the same cluster without overwriting the recurrence query.

## Timeline semantics

Positive source intervals overlap a half-open window. Explicit instants are
points, with no invented end/duration. Missing dates, partial time expressions,
invalid intervals and unresolved facts remain in a separate review list. Every
canonical extraction remains unvalidated and requires review; plotting does not
mark it operationally confirmed. Source dates are retained, including historical
examples. Use the calendar date control to inspect them. The optional timeline
hybrid query uses a bounded ranked parent selection and reports truncation.

## Private state and compatibility

The existing generated ConnectRPC service clients remain in use for identity,
drafts, structured preparation and acknowledgement history. Rust uses the
`connectrpc` SDK, generated at build time from the original application proto
files; no generated TypeScript or Ark framework code is patched. The legacy
`SourceDataService/ReadSchedules` RPC returns the first browsing page for the
existing reminders component; it is not a complete snapshot.

Private state in the hidden OpenSearch index binds the stable issuer/subject owner
to the full message revision key. Demo owners remain separate. Drafts and
preparations remain unsent; the API rejects attempts to record a sent
acknowledgement before SMTP sending exists. Canonical existence is checked before
private reads/writes. History is retained with the private aggregate.

Authentication has explicit `local_demo` and `oidc` modes; OIDC never falls back to
demo accounts. Browser-supplied identity headers are ignored. See the
[authentication contract](settings-oidc.md#keycloak--uds-client-contract) for cookie,
origin, revocation, expiry and role behavior. Production Exchange PKI remains a
separate intake transport requirement. The UDS profile requires verified implicit
IMAP TLS and the explicit mesh search policy; see the
[UDS runbook](../../deploy/uds/README.md).

Confirmed UI behavior: one search input invokes BM25 plus local MiniLM semantic
search in a single hybrid query, fused by OpenSearch RRF. No search-mode or
dataset dropdown is present. `rank_constant: 60` and equal clause weights are
the OpenSearch defaults; no relevance gain is claimed without a judged query set.
The read-only `backend/search/verify_application_search.py` checks both clauses,
identical filters and actual RRF score arithmetic against the deployed cluster.
See the [OpenSearch score ranker documentation](https://docs.opensearch.org/latest/search-plugins/search-pipelines/score-ranker-processor/).

### Message-reader source sets and acknowledgement drafts

A canonical detail read adds `sets` and `source_profile` to its presentation-only
`structuredPayloadJson`. These are projected from the matching revision's
`parse_completed` audit record, not stored again in the canonical index. Each
set contains `set_id`, ordered `fields: [{position, value}]`, and ordered
`rows: [{fields: [{position, value}]}]`. Every value is checked against its UTF-8
byte span in the hash-verified decoded body. Audit/rule IDs and spans stay out
of this projection. Repeated sets, free text, source placeholders and columnar
cells retain their original values. Missing source sets produce an unavailable
state; the browser does not reparse raw USMTF or render internal facts as sets.

The viewer uses compact source-set cards and a review pill. Metadata and
narrative cards have layouts for their content; frequency plans use a channel
table. Labels select the baseline or observed-extension layout explicitly.
Unregistered positions retain their original source values without invented labels.
The actions sidebar is removed. Lifecycle remains a separate tab with a vertical timeline.

`Send Acknowledgement` opens a modal that generates and privately saves an
**unsent** draft through the existing preparation API. The only editable form
control is an unselected acknowledgement-type dropdown. The selected response
chooses ACTAGCY or ICVALID exclusively; generating the reviewed draft is the
explicit response/authority confirmation. Source type, originator, serial and
verified issue date supply REF; receipt/current dates are never substituted.
REF represents the source issue minute in its required DTG form; original
second precision remains in the source MSGID card and raw body. Missing
mandatory reference data blocks generation with a compact field error.

Outgoing command and responding authority come from shared Settings. Both must be configured before draft generation; no placeholder authority is supplied. Saving/copying a draft never records a sent or
acknowledged state. The status pill distinguishes existing externally recorded
acknowledgement, a saved unsent draft, and no acknowledgement. No SMTP sending
is added by this change. Private state remains isolated by the existing verified
identity/session cache boundary.

### Lifecycle and parse completion

Canonical detail reads populate the existing `lifecycleEntries` presentation
contract from the matching body/revision's hidden OpenSearch custody records: source issue
instant, ingestion, processing/retry failures, parsing and indexed time.
Issue time is anchored first; subsequent recorded events are chronological.
Ingestion time is the durable local receipt time, distinct from mailbox receipt
and USMTF issue time. New publication failures are persisted as static categories
before retry; their history survives recovery. Decoded body identity is recorded
before parsing, allowing failed attempts to remain associated with a later
successful receipt of the same body. Unattributable pre-receipt/mailbox failures
are not assigned to an arbitrary message. Historical timestamps that were never
recorded cannot be reconstructed.

Reads are scoped by body/revision, use indexed hidden-state envelope fields,
and bound custody/publication selections at 500 entries each.
`lifecycle_state` and `lifecycle_limited` identify unavailable/truncated history.
Actual acknowledgement-send events use `acknowledgement_sent` with the real
send timestamp; until SMTP sending is implemented, the viewer shows Pending.
Draft generation/copying never creates a send event.

The Parsed badge means successful source parsing and canonical validation;
record interpretation errors still show needs review. Operational uncertainty
such as a missing month, source time conflicts, named map locations or an
inferred profile does not itself mean source parsing failed. All fourteen
original manual examples remain unchanged and are checked with the external
source-conformance and expected-fact regression suites.

The approved current-year rule binds missing source years to the immutable UTC
intake-recorded year, audits that decision, preserves explicit source years and
leaves other missing date components unresolved. Named locations remain valid
without geometry; their unresolved geometry status is not a compliance error.
Existing immutable interpretations retain their original audit history;
reprocessing changed interpretation rules requires a new revision per the ICD.

### Notification inbox

`POST /api/v1/notifications/{operation}` uses the same session identity and
same-origin checks as message reads. The request never accepts an owner/user ID;
read state is private to the stable authenticated owner and persists in the hidden
application-state index. It is available across browsers using that identity.

| Operation | Request | Response |
| --- | --- | --- |
| `list` | `{}` or `{ "before": 123 }` | `items` (up to 20), total `unread`, `watermark`, `nextBefore`, `catchingUp` |
| `members` | `{ "id": 12, "before": 123 }` (`before` optional) | Up to 20 messages in a traffic group and `nextBefore` |
| `read` | `{ "id": 12, "version": 123 }` **or** `{ "through": 123 }` | `{ "saved": true }` |

An inbox item contains `id`, `version`, `kind` (`traffic`, `failed`, `recovered`),
`context`, `messageKey`, `at`, `detail`, `resolvedAt`, `count`, and `unread`.
IDs and versions are transport tokens, never display text. `at` is an actual
recorded custody/publication timestamp, displayed in the user's selected IANA timezone; traffic becomes
available when message publication succeeds. Group members contain the source
subject, message type/originator context, message link, timestamp and version.
The message viewer accepts `tab=lifecycle` for notification links.

The server incrementally reads at most 256 events from each custody/publication
stream per request and commits its cursor with the resulting inbox updates.
Publication successes are recorded in the same transaction as job completion;
existing active published messages are backfilled using their recorded publication
times. Replays do not duplicate notifications. Repeated failures of the same receipt
or publication job coalesce until a recorded success creates a recovery notice.
A different job succeeding cannot resolve that failure. Original custody/audit
history remains intact. The inbox retains its latest 5,000 entries; member/read
rows are removed with retired inbox entries. Source deduplication and replay
cursors remain durable.

Distinct newly published messages within one fixed five-minute UTC window form
one traffic notification. Opening that group lists its messages; a single-message
notification opens its message directly. Duplicate delivery does not announce a
new message. Reading an item stores the version the user actually viewed. Marking
all read uses the displayed watermark, so arrivals after that snapshot remain
unread. Neither operation changes message acknowledgements or incident recovery.

The compact header inbox has no daily reminder, source IDs, explanatory footer,
or alerts derived from interpretation flags. The present event producers are
intake and publication failures/recoveries and newly published message traffic.
No operational schedule-change event producer exists yet; schedule uncertainty,
parser re-interpretation and draft edits are not represented as schedule changes.
The UI polls every 30 seconds while foregrounded (one second during bounded
catch-up); notifications use local storage/API resources only, without OpenSearch
searches, email delivery, push services, or runtime external dependencies.

## Watch, station and briefing APIs

The native `/auth/*` routes remain the authentication boundary. Additional
`GET /api/v1/auth/session` returns profile/station metadata for that already
validated session; it does not create a competing login mechanism. Account
preferences are read from that profile and updated with `PATCH /api/v1/account/settings`; native shared settings and
IANA timezone APIs retain their existing authority. Admin station management uses
`GET /api/v1/users` and `PATCH /api/v1/users/{id}`. Role/enablement/revocation remain
with native IdP claims and `/api/v1/settings/*`, not station updates.

Responsibility directory routes are `/api/v1/responsibilities` and
`/api/v1/briefing/responsibilities` (and their `/{id}` mutations). Profiles contain
explicit message categories; names never infer scope. Assigned command/category
scope is applied by the server to searches, hydration, details, evidence, related
messages, notifications and canonical private-state operations. Personal
preferences may narrow but cannot broaden that assignment. Read windows bind the
current scope so station changes invalidate earlier paging tokens.

`POST /api/v1/briefing` pages a frozen login window. First availability is recorded
in a single CAS-updated custody ledger with its sequence; old issue dates stay
separate from arrival. Refreshing access tokens does not advance that login
window. Later login sessions capture the next checkpoint. The ledger is bounded;
full capacity fails explicitly and requires an archival plan.

`POST /api/v1/messages/similar` takes an exact seed key. Rust obtains the seed's
source content and enforces its scope; callers cannot substitute source text or
broaden result filters. A new `POST /api/v1/changes/list` supplies bounded watch
turnover results. `/api/v1/watch-context/{operation}` manages shared roster/watch
context and conflict-checked field updates. `POST /api/v1/commands/list` supplies
command choices. The UI separates watch context at `/watch-settings` from the
native administrator settings modal.

Daily crypto recurrences in ICD 1.3 expand only within requested calendar bounds;
each occurrence keeps its source fact link and review state. Partial/unresolved
time expressions remain unresolved. These extensions do not send messages or
turn a private draft into an acknowledgement.
