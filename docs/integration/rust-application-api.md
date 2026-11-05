# Rust application API

The React app calls the same-origin Rust server through `web`. OpenSearch DSL,
index names, model IDs, passage grouping and search templates stay in Rust.
The browser does not receive vectors, credentials or arbitrary query access.
The parsed-message ICD 1.1.0 remains the contributor/storage contract.

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
not RFC email senders. The UI's issued-through date includes that entire Zulu day;
it becomes the next midnight in the exclusive `issuedTo` API parameter.

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

Read-window state lives in separate ephemeral `read_windows` rows in the private
SQLite database. It is limited to 64 windows, 512 KiB each, with 110-second idle
expiry renewed by active paging. It contains bounded metadata/excerpts or PIT
anchors, never vectors, raw email or audit payloads. Expired/mismatched windows
fail explicitly; retry starts a fresh search. They do not alter drafts or custody.

Filters support issue-time bounds `issuedFrom` inclusive / `issuedTo` exclusive,
up to 32 exact values in each metadata list, and unassigned-only selection.
Selected command IDs plus unassigned selection form a union. Unknown or empty
explicit command selections must not broaden to all commands. Participants and
originators are not assumed to be locally assigned command IDs.

Browsing uses a 60-second OpenSearch PIT and a server-held opaque cursor expiring
after 55 seconds. Cursors bind owner and filters; there are at most 64 active
cursors. Expiry requires restarting browsing. Search preserves passage rank when
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
| `parse-command-timeline-v1` | Bounded activity retrieval for the UTC window |
| `parse-command-evidence-list-v1` | Revision/fact/kind-filtered audit paging |
| `parse-command-source-status-v1` | Embedding-state aggregation |
| `parse-command-passages-keyword-v2` | BM25 narrative/subject search |
| `parse-command-passages-semantic-v2` | Local MiniLM neural search, ready passages |
| `parse-command-passages-hybrid-v2` | Filtered BM25 + neural search, RRF pipeline |

The server supplies validated template parameters, not browser-provided DSL.
`publisher.rs::templates` owns their source. Older v1 passage templates remain
available to existing test tools; the application uses v2's larger candidate
window. The existing local ingest pipeline/model pins remain unchanged.

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

Private SQLite data binds `dev-user` / `dev-admin` to the full revision key.
Drafts remain unsent. Preparation validation, authority confirmation, response
families and append-only user-reported acknowledgement history match the old Go
behavior. Responses include the latest 100 history entries; all history remains
stored. Canonical existence is checked before private reads/writes. There is no
message-send operation.

This deployment uses an explicit **local_demo** authentication profile. Random,
HttpOnly, SameSite=Strict session cookies identify demo accounts; only hashes are
stored. Browser-supplied identity headers are ignored. Production Exchange PKI,
TLS and operational user authentication remain separate deployment work.

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
Unregistered positions retain their source value with a neutral field label.
The previous technical lifecycle/actions sidebar is no longer displayed.

`Send Acknowledgement` opens a modal that generates and privately saves an
**unsent** draft through the existing preparation API. The only editable form
control is an unselected acknowledgement-type dropdown. The selected response
chooses ACTAGCY or ICVALID exclusively; generating the reviewed draft is the
explicit response/authority confirmation. Source type, originator, serial and
verified issue date supply REF; receipt/current dates are never substituted.
REF represents the source issue minute in its required DTG form; original
second precision remains in the source MSGID card and raw body. Missing
mandatory reference data blocks generation with a compact field error.

Outgoing command and responding authority temporarily use the user-approved
`FLEETHACKER` placeholder. Shared Settings must replace both independently;
tracked in GitHub issue #6. Saving/copying a draft never records a sent or
acknowledged state. The status pill distinguishes existing externally recorded
acknowledgement, a saved unsent draft, and no acknowledgement. No SMTP sending
is added by this change. Private state remains isolated by the existing verified
identity/session cache boundary.
