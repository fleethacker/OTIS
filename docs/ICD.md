# Parse Command Interface Control Document

**Contract:** PC-ICD-001 · **Version:** 1.3.0 · **Date:** 2026-11-05

**Status:** compact data contract and compiled contributor interface. The Rust host
implements parsing, durable IMAP custody in OpenSearch, continuous publication and
the application read API. Production authentication/PKI and operational interpretation
remain separate acceptance gates; an extracted report does not establish readiness.

## 1. Scope and authority

This ICD defines the parsed-message wire format, message-parser contribution boundary, interpretation rules, audit linkage and OpenSearch storage expectations. It does not define the UI's HTTP routes, select an embedding model, or promise a hardware capacity. Contributions are Rust modules/crates compiled into the host; runtime plugin loading is outside v1.

Enabled message families are OPTASK and CASREP. GENADMIN is a separate message family and is not a CASREP profile. The common interface also permits other teams to implement additional USMTF message types without modifying IMAP intake, persistence or search. Adding a parser does not automatically enable that message type in deployment.

Normative terms **MUST**, **MUST NOT** and **SHOULD** describe conformance requirements. JSON Schema is authoritative for JSON field names, types and structural constraints; the semantic rules here remain mandatory even when JSON Schema cannot express a cross-field or cross-document condition. Changes to the approved shape require a versioned contract update.

Machine-readable files:

- [Shared types](schemas/types.schema.json)
- [Message schema](schemas/message.schema.json)
- [Passage schema](schemas/passage.schema.json)
- [Audit-event schema](schemas/audit-event.schema.json)

Schemas use JSON Schema Draft 2020-12. Register all four resources locally by their `$id` URNs; no network schema resolution is required or permitted in the airgapped runtime. The `$schema` URI identifies the standard, not a runtime download dependency. Metadata/configuration records the contract version; core documents do not repeat it per fact.

## 2. Component responsibilities

| Host | Contributed parser crate |
| --- | --- |
| Email intake, MIME/wrapper decoding, durable acceptance and work queue | Exact message-type/profile declarations |
| Original source preservation and common USMTF scanner | Message-specific field/segment validation |
| IDs, revision publication, retention and storage routing | Evidence-backed interpretation into common facts |
| Security enforcement and approved command/roster resolution | Explicit unresolved/inferred states and audit detail |
| OpenSearch writes, bounded audit batches, local inference and API | Labeled fixtures, rule references and conformance evidence |

Parsers MUST NOT perform network access, retrieve URLs in messages, access mail credentials, write to OpenSearch, choose index names, execute source text, or independently change lifecycle/security policy. Domain interpretation is synchronous and deterministic for the same input, profile and explicit context. The host owns async I/O and bounded worker scheduling.

The operating target is a CPU-only laptop-style deployment. Runtime must work entirely inside the airgapped enclave. Builds/artifact preparation may occur online. Numeric queue/memory/concurrency/batch limits remain explicit deployment configuration; no values are implied by this ICD.

### 2.1 Email subject and wrapper boundary

Email subject is first-class display/search data in the required nullable `subject` field on messages and passages. Preserve the original subject/header and any wrapper transformations in audit. An absent subject is null, not a fabricated value based on message type, filename or a narrative section title. An explicitly empty header is retained in audit and projects to null.

Confirmed transport/framing: SMTP delivers email, Parse Command retrieves it using IMAP, the decoded email body starts with `MSGID`, and the email subject value starts with `SUBJ:`. `SMTP` is not a USMTF body marker. The host MUST extract the email subject from the email header rather than searching arbitrary body text for `SUBJ:`.

The host decodes the subject header, removes one literal leading `SUBJ:` indicator and surrounding presentation whitespace for the core `subject`, and preserves the original header/decoded value and transformation in audit. Do not remove an interior occurrence of `SUBJ:` or truncate at a colon inside the subject text. Missing/empty content projects to null with audit detail; a missing expected marker must not cause source data to be discarded.

The host extracts email metadata before parser dispatch and preserves a mapping to the original email/body. Email subject MUST NOT select the parser or replace `MSGID`. For duplicate bodies, the email with the latest server IMAP INTERNALDATE supplies the display subject, with local durable receipt order breaking ties; differences retain a `subject_conflict` flag and all receipt/header history. Receipt-level subject/header evidence belongs in an `email_received` audit event (with receipt identity in its payload); the original USMTF source/hash remains body-based. If duplicate bodies arrive under different subjects, preserve each receipt's subject in audit and flag conflicting display metadata rather than silently overwriting it; the selected receipt identity remains in the custody journal.

The supplied fixtures are bare USMTF text, not full emails. Their `subject` values are therefore null. A future full-email fixture should exercise Subject/SUBJ decoding and body-to-source mapping separately from domain parsing.

## 3. Identity, revisions and joining

| Field | Contract |
| --- | --- |
| Message `id` | `sha256:` plus 64 lowercase hexadecimal digits of the exact UTF-8 decoded USMTF source bytes preserved in audit. Whitespace is not silently rewritten before hashing. Email receipt identity is separate. |
| `revision` | Nonempty opaque revision token, 1-64 ASCII letters/digits/dot/underscore/hyphen, starting with a letter/digit. Stable for one immutable interpretation. |
| Fact `id` | Message/revision-scoped `aN`, `fN`, `cN`, `vN`, `gN`, `rN` or `qN` for activities, frequencies, contacts, periods, locations, recurrences and casualty reports; N starts at 1. No duplicates within the revision. |
| Passage `id` | Content-derived `sha256:` identifier assigned by the host, stable for the same source revision and chunking inputs. |
| Audit `id` | Host-assigned deterministic 64-digit lowercase hexadecimal event identifier for one immutable event. Persist its identity/timestamp/content before retries. |

Audit joins use `(message_id, revision)` and optionally `subject_id`. Audit `subject_id` identifies the core fact being audited; it is unrelated to email subject text. Message or fact IDs alone are insufficient to identify an interpretation across revisions. A new interpretation MUST use a new revision. An ID MUST NOT be reused for different immutable content. The host MUST prevent mixing passage revisions with a different published message revision.

Core documents MUST NOT contain byte spans, field positions, parser rules, detailed diagnostics, raw record arrays or original-source provenance. These belong in audit. Small IDs, uncertainty/status indicators and user-visible review flags belong in the core.

## 4. Compact message document

Required fields are exactly the message schema's `required` list; unknown core properties are rejected. Collections are arrays, including when empty. `null`, an empty collection and an omitted optional field have different meanings; do not replace them interchangeably.

| Field | Type / meaning |
| --- | --- |
| `id`, `revision` | Identity as defined above |
| `type` | Exact message identifier; preserve distinctions between a base message and its supplement |
| `subject` | Email subject for display/search, or null when not supplied; source header/marker evidence lives in audit |
| `originator` | Source originator; not automatically the tasked unit |
| `serial` | String or null; preserve leading zeros |
| `issued_at` | Resolved issue instant in UTC, or null; not receipt/event/validity time |
| `expires_at` | Host-computed issue instant + 365 elapsed days, or null when issue time is unresolved |
| `security` | Source policy/classification/release groups and validation status |
| `command_ids` | Resolved command identifiers from the approved roster/policy; an empty list does not mean “all commands” |
| `status` | `ready`, `needs_review`, or `partial`; not an authorization grant |
| `periods` | Validity intervals/open ends, distinct from event occurrences |
| `frequencies` | Displayable frequency entries, optionally grouped by plan/designator/channel/scope |
| `activities` | Displayable tasking, points, windows and reporting requirements |
| `contacts` | Source contact/coordination information |
| `locations` | Optional geographic points/shapes with datum and interpretation state |
| `recurrences` | Optional source-anchored recurring schedule companions; existing activities remain unchanged |
| `review_flags` | Optional unique short warning codes needed by the user; full explanations live in audit |

### 4.1 Security

`security` has `policy`, nullable `classification`, `release_to` and `status`. Accepted classification strings are `UNCLASSIFIED`, `CONFIDENTIAL`, `SECRET` and `TOP SECRET`; an unrecognized value yields null plus audit detail and a review flag. Validation status is `unvalidated`, `validated` or `conflict`.

Release entries preserve the source grouping until an approved security policy resolves them. A parser MUST NOT infer an access grant from absent/misspelled markings, raw release strings or `status: ready`. The host applies authorization consistently to messages, passages and audit lookups. Core command filtering is not authorization.

### 4.2 Periods and time fields

Periods use `id` and endpoint fields such as `start_at`/`end_at`, or unresolved endpoint representations `*_time`, `*_label`, `*_status`. An endpoint MUST have at least one representation. `end_status: open_ended` represents an explicit open end; do not substitute midnight.

Resolved `*_at`/`at` values are UTC RFC 3339 date-times ending in `Z`. Time-only fields use `HH:MMZ` when UTC is explicit or `HH:MM` when the zone is unresolved. They are not instants. Raw partial-date tokens needed for display may use `time_label`/`*_label`; full token components and the source evidence remain in audit.

An unresolved status MUST NOT coexist with a contradictory asserted instant for the same endpoint. No timezone conversion may invent a missing date. A resolved interval's end MUST NOT precede its start; an inconsistent source remains in audit and the core is flagged rather than silently repaired.

### 4.3 Frequency entries

Frequency fields are `id`, nullable `hz`, optional `upper_hz`, `plan`, `designator`, `channel`, `emission`, `usage`, `scope` and `status`.

- `hz` and `upper_hz` are checked nonnegative signed-64-bit integers. Range upper bound MUST be at least its lower bound.
- Convert HZ/KHZ/MHZ/GHZ using checked decimal arithmetic, not an imprecise float followed by unchecked rounding. If an exact source value cannot be represented, retain it in audit and flag the unresolved projection rather than rounding silently.
- A missing source value is `hz: null` with `status: unavailable`; zero is a numeric value, not a missing-data sentinel.
- Channels/designators/circuit identifiers are not frequencies. Do not assign units to an unlabeled number without the applicable format definition.
- Repeated entries and unavailable channels MUST remain distinct; do not overwrite an array entry because its plan/set name repeats.

### 4.4 Activities

Activities require `id`, `type` and `status`. Status is `inferred`, `validated` or `unresolved`. A syntactically complete timestamp does not make its inferred semantic role validated.

Common fields are `participants`, `scope`, `at`, `time`, `time_label`, `time_status`, `start_*`, `end_*`, `as_of_*`, `deadline_*`, plus the optional display fields listed in the schema. Participant names are source participants, not automatically resolved command IDs or a claim of task applicability for every surrounding record.

| Common `type` | Interpretation / relevant fields |
| --- | --- |
| `communications_check` | Point/check: `at` or unresolved time; participants, coordination and circuits |
| `communications_plan_window` | Plan/variant and start/end representations; no automatic daily recurrence |
| `communications_guard_window` | Start/end representations, participants, line/mode/material reference |
| `crypto_changeover` | Point/time-only representation, equipment/material/scope when known; no invented duration. An additive source-period companion may supply recurrence under §4.6 |
| `replenishment_rendezvous` | Point/partial time plus source position/course/policy |
| `reporting_requirement` | Required `report` and `responsible_party`; as-of/deadline representations and delivery guidance |
| `tasking` | Required `task_type` and `description`; timing/applicability only when supported |

Other activity type tokens are permitted by the schema, but MUST use the existing common fields and a documented type meaning. UI consumers MUST provide a generic detail view for an unfamiliar type. Adding arbitrary properties requires a versioned schema/mapping update. Additional domain details can stay in audit until a shared field is approved.

Reporting `as_of` and `deadline` fields are not interchangeable. A deadline earlier on the clock than an as-of time MUST NOT automatically be assigned to the next day. Conditional guidance is a label/status, not an invented appointment.

### 4.5 Contacts and scope

Contacts require `id`, `name`, `position`, `unit`, and `channels`; optional fields are source `role`, `location` and `scope`. Each channel has `type` and `value`. Preserve multiple phone/email/radio/chat alternatives.

`position` can be rank or source staff position. `role` is the explicit source coordinating role; neither field alone assigns the receiving ship's CO/XO/OPS/CHENG. Local routing requires the approved command roster/policy and a future deliberately defined projection if not already represented. Do not overload `role` with an inferred local assignment.

`scope` is a compact display context, not a provenance array or authorization boundary. Full segment/record associations and inference basis live in audit. Ambiguous context MUST remain unresolved and MUST NOT be promoted to certain applicability.

### 4.6 Source-anchored recurrence companions (1.2.0)

`recurrences` is an optional collection; its absence leaves 1.1 documents valid.
Each `rN` fact carries `type`, semantic `rule` (RRULE value), `status`, optional
`activity_id`, explicit-source `dtstart`, optional `until`/`count`, `exdates`, and
optional display `scope`. A linked activity must exist in the same message/revision
and have the same type. Do not rewrite that activity's fields or ID. `rule` is a
schedule pattern, **not** parser-rule provenance: byte spans, source locators,
interpretation rule IDs, and period/clock evidence belong in linked `fact_interpreted`
audit entries. Every recurrence requires audit coverage just like any other fact.

The first implementation supports Zulu-only `FREQ=HOURLY|DAILY|WEEKLY`, `INTERVAL`,
`BYHOUR`, `BYMINUTE`, unnumbered `BYDAY` for weekly rules, `COUNT`, and `UNTIL`.
Intervals/counts are positive and at most 1,000,000; rules are at most 512 bytes;
at most 4,096 exclusion instants. Unknown parts, invalid combinations, missing
anchors and unsupported clock/calendar precision remain visible review, never a
silent default schedule. `COUNT` and `UNTIL` cannot be combined. `UNTIL` is inclusive;
timeline windows are `[from,to)`. `COUNT` counts scheduled positions before `EXDATE`
removal, so exclusions never manufacture replacement occurrences. Weeks start Monday.

**Bounded-rule convention, not a full iCalendar component:** `dtstart` is the explicit
source lower bound/phase anchor (e.g. a message PERIOD start). Only matching clock/day
positions at or after it are emitted; an unmatched midnight bound is not an extra
occurrence. This deliberately defines the case left undefined by RFC 5545 when
component DTSTART does not match its pattern. No RDATE, TZID/DST, BYSECOND, ordinal
weekdays, monthly/yearly rules, or duration synthesis is supported. See RFC 5545
§3.3.10 and §3.8.5 for the underlying rule/exception semantics.

Baseline crypto daily-shift evidence may produce a companion only with one
unambiguous message-wide period whose anchor is explicit in source, including its
year. A receipt-year-defaulted period is not an explicit recurrence anchor. A declared
UFN may produce an open-ended companion. No period, incomplete source date/zone,
or multiple message-wide periods leave the original time-only activity unchanged.
The static rule is `optask.crypto.recurrence.v1`, with crypto-record and PERIOD
source evidence linked in audit. Real recurring COMCHECK/other sets remain future
mapping work; the separate exact-hash fictional radio-check path is not general
OPTASK grammar or operational assignment/security policy.

Expansion occurs only in the requested window and consumes the existing timeline
fact bound. Open-ended rules are marked `ongoing`, not completed or cancelled.
Occurrences are points unless an independently supported duration contract is added.
Presentation identity is `ruleFactId@occurrenceInstant` (canonical UTC seconds), scoped
by message/revision. The audited source fact remains `rN`, exposed as `sourceFactId`;
occurrence IDs are not new core/audit subject IDs. This creates a stable target for
future occurrence amendments/cancellation/acknowledgement, not those producers or
permissions themselves. Source exclusions do not create a dated cancellation feed.

## 5. Search-passage document

The passage schema requires `id`, `message_id`, `revision`, `ordinal`, `type`, `subject`, `originator`, `issued_at`, `expires_at`, `security`, `command_ids`, `mentioned_units`, `text` and `embedding_status`.

- `ordinal` starts at 1 within a message/revision; duplicate ordinals are invalid.
- Parent identity, revision, subject, issue/expiry and security metadata MUST agree with the published message projection. Subject is a lexical text field alongside passage body text; it need not be duplicated into stored `text` just to make it searchable.
- `mentioned_units` supports source-reference retrieval. A matching mention does not assert operational task assignment.
- `text` is the common lexical field and local embedding input. It includes enough context to make the passage meaningful without inventing source facts.
- `embedding_status` is `pending`, `ready` or `failed`. Only `ready` permits and requires `embedding`; other states omit the vector. Vectors MUST be finite numbers of the configured model dimension. JSON Schema cannot fix a dimension until the model is selected.
- Preserve passage-to-record spans and chunking/model/rule detail in audit, not the core passage.

The host MUST use tokenizer-aware bounds before operational embedding; truncating long orders to the first model-sized prefix is not conformant. Respect format/segment boundaries where possible and retain source-mapped splits of oversized free text. The external fixtures' grouping is illustrative, not a validated model token budget.

Index lexical passages without requiring embedding success. Later inference updates the same passage identity. Hybrid branches MUST enforce equivalent command/security/time constraints. Do not apply a global ready-vector filter that removes pending passages from lexical fallback. A fallback response identifies the mode actually executed.

## 6. Audit document and durable batching

The audit schema requires `id`, `message_id`, `revision`, `kind`, `recorded_at`, `security` and `payload`. Optional fields are `subject_id`, `issued_at` and `review_only`.

`recorded_at` is the immutable audit event creation instant, not message issue time. The payload is an object whose contents are stored but unindexed. Index only lookup/time/type/security metadata. Audit is a separate OpenSearch index; it is not application stdout or part of the vector-search corpus.

| `kind` | Payload responsibility |
| --- | --- |
| `source_preserved` | Exact UTF-8 source text/hash/byte length and available transport provenance, once per source/revision ownership policy |
| `email_received` | Receipt identity, original/decoded email Subject value, SUBJ transformation, available envelope metadata and body/source association; no mailbox credentials |
| `parse_completed` | Parsed header/profile, ordered records and fields, spans, entities, validation coverage and detailed diagnostics |
| `fact_interpreted` | Original interpretation for a short core `subject_id`, with record/field evidence and rule provenance |
| `search_projection_prepared` | Passage identity/order, source record/span relationships and chunking/inference preparation metadata |

Custom namespaced audit kinds may use the same envelope. Core type-specific extensions MUST NOT be hidden in arbitrary indexed field names.

The host MUST durably stage core write intents and audit entries together before publishing the core projection. It MAY publish the core before the audit-index flush once audit intent is durable; an evidence endpoint must distinguish pending audit from absent evidence.

Audit workers MUST enforce configured entry-count, serialized-byte, flush-age and concurrency limits. Check every Bulk item; an HTTP 200 does not mean every item succeeded. Acknowledge journal entries only after their corresponding writes succeed. Retry transient failures with bounded backoff, retain permanent failures for operator handling, and apply intake backpressure before audit disk capacity is exhausted.

Use stable event IDs and persist concrete backing-index targets across rollover. Duplicate-create conflicts are successful replays only when verified against the same immutable event intent; do not accept every 409 indiscriminately. There is no cross-index atomic transaction or exactly-once transport guarantee.

Audit retention/time origin and cleanup order remain deployment decisions. Never delete the only source evidence because a separate core index rolled over or a batch temporarily failed.

## 7. Interpretation and uncertainty rules

Detailed message-format grammar, manual-derived field tables, format coverage and source locators are maintained outside Git under `../OPTASK_Messages/knowledge`. This ICD defines the common representation and contribution obligations; it does not reproduce that format knowledge or sample traffic. Contributors obtain the applicable format specifications and external knowledge package separately.

1. A parser MUST declare compatible profiles and select them from actual source evidence. Preserve the source's declared version; do not silently reinterpret an incompatible layout.
2. Definition-backed and example-inferred rules MUST be distinguished in audit. Unknown or ambiguous fields remain preserved with explicit coverage limits; successful decoding is not proof of complete interpretation.
3. Missing values, unavailable data and an explicit numeric zero are distinct. Preserve repetition and contextual association; do not overwrite entries just because a label repeats.
4. Issue time, validity, occurrence, deadline and recurrence are different concepts. Missing date/time context MUST NOT be filled using the host clock or receipt time without an approved recorded rule. The approved current-year rule uses the immutable UTC intake-recorded year when a source supplies day, month and Zulu time but omits the year; audit records identify the year and affected fields. It does not fill a missing month, day or timezone, and explicit source years always win. Do not invent an event duration or recurrence for display.
5. Operational retention is 90 hot days followed by 275 searchable cold days, 365 elapsed days total from issue time. Receipt/replay/reindex does not restart that clock. Unresolved issue time means unresolved expiry, and index age is not inherently message age.
6. Participants, mentions, originators, task applicability and local coordinating roles MUST remain distinct. Resolve command identity/group membership/routing only through approved context; preserve uncertainty otherwise.
7. Do not silently repair contradictory dates or markings, apply unapproved amendment precedence, or fabricate a required activity from unrelated source material. Keep small user-visible review flags in core and detailed explanations in audit.
8. The source email subject is metadata, not the parser identity or a substitute for structured message content. Original email/body evidence remains available through audit under the same applicable authorization policy.

## 8. Rust contribution interface

The following trait is implemented by the local `parse-command-parser-api` crate in [`backend/`](../backend/README.md). SDK 0.2.0 is linked through workspace/path dependencies and has not been published to a package registry. See the synthetic reference parser and host integration tests for a compiling contribution example. This is a Rust source contract, not a C ABI or dynamically loaded binary ABI.

```rust
pub trait MessageParser: Send + Sync {
    fn descriptor(&self) -> &'static ParserDescriptor;
    fn assess(&self, input: &MessageView<'_>) -> MatchOutcome;
    fn parse(
        &self,
        input: &MessageView<'_>,
        context: &ParseContext<'_>,
        output: &mut dyn ParseSink,
    ) -> Result<ParseSummary, ParseFailure>;
}
```

| SDK concept | Required contract |
| --- | --- |
| `ParserDescriptor` | Stable parser ID, parser version, ICD major version, exact message identifiers, profiles/signature rules and supported fact categories |
| `MessageView<'a>` | Borrowed immutable USMTF body `&'a str`, optional decoded email subject metadata, representation identity, exact message-type evidence, ordered record views and field views, source spans |
| `ParseContext<'a>` | Host identity/revision, immutable explicit roster/rule context, optional provenance-bearing reference time, work/output budget and cancellation access |
| `MatchOutcome` | Unsupported, applicable with identified profile/evidence, or ambiguous with reason; not an arbitrary floating confidence score |
| `ParseSink` | Separate bounded methods to emit header interpretations, periods, frequencies, activities, contacts, locations, recurrence companions, review flags and audit entries; returns a limit/error result on exhaustion |
| `ParseSummary` | Declared coverage/completeness and parser/profile version; success does not mean complete semantics |
| `ParseFailure` | Unsupported profile, ambiguous profile, malformed input, invalid value, resource limit, cancellation or internal defect, with a bounded safe reason code |

Shared core DTO fields serialize exactly as the JSON schemas specify; named operations above do not add a new wire wrapper. The host finalizes message IDs, issue-based expiry, metadata consistency, revision publication and storage/audit envelopes. A crate MUST NOT claim authority over those host-owned decisions by emitting replacement policy fields.

In SDK 0.2.0, `MessageView` represents the exact decoded UTF-8 body; spans are byte offsets into that body. `ParseContext` exposes revision, explicit recording time, command IDs, optional host security override, optional reference time/provenance and a cooperative work budget. The intake adapter records MIME representation provenance and stages revisions and outbox intents in SQLite. Additional roster/rule contexts and continuous batched delivery remain later adapter work; they are not implicit inputs. `ParseSummary` contains profile and complete/partial coverage, while parser identity/version comes from the descriptor. Explicit host output limits constrain the sink. The host requires an audit entry linked to every emitted fact ID and returns validated in-memory core/audit streams together.

Parser output limits apply to both core facts and audit detail. Prefer borrowed views/offsets while parsing. A time limit around a synchronous call cannot forcibly cancel an infinite loop; parsers must cooperate with budgets and cancellation. Compiled Rust code runs with host authority: traits are not a sandbox. Review dependencies/unsafe code and exercise malformed/oversized input before enablement.

### Registration and conflict handling

1. The host builds an explicit registry of compiled parser descriptors.
2. Reject incompatible ICD major versions, duplicate parser identities and conflicting identical claims during registry validation.
3. Route by exact message identifier and applicable profile evidence. Registration order MUST NOT select a winner.
4. If multiple candidates remain applicable, report ambiguity instead of invoking the first one.
5. Unsupported messages remain durably available for later parser support and explicit reprocessing, under retention policy.

### Contribution package checklist

- Crate source, descriptor, supported identifiers/profiles and dependency manifest.
- Named definition-backed or inference-backed rule catalog and known limitations.
- Valid/minimal, repeated-segment, missing-field, ambiguous-profile, invalid-time/checksum and resource-limit fixtures with expected core and audit JSON.
- Schema validation, deterministic output, source-span accuracy, no field leakage into core, and byte/record/output bounds.
- Generic unknown-type/partial UI behavior; no host transport/storage changes required to add the parser.
- Integration and deterministic replay evidence through the shared host harness, with parser-specific malformed-input and boundary tests. Durable replay through mail/storage adapters remains a separate acceptance gate.

Each team keeps fixture corpora outside Git under the agreed data-handling practice. The host repository contains only contract/schema/tooling, not operational or provided sample traffic.

## 9. OpenSearch binding and UI fixture loading

Three isolated UI fixture index-creation bodies are supplied:

- [Messages](opensearch/messages.ui-index.json): explicit compact mappings with query-relevant tuples nested.
- [Passages](opensearch/passages.ui-index.json): BM25 `text` plus filter metadata; no model/vector dimension selected.
- [Audit](opensearch/audit.ui-index.json): lookup/time/type/security fields indexed; `payload` has `enabled: false`.

The fixture aliases are `parse-command-ui-messages`, `parse-command-ui-passages`, and `parse-command-ui-audit`. Their backing indices are created with matching names plus `-v1`. These names identify a test profile, not a production index naming decision. Production shard/replica counts, resource limits, lifecycle policies, auth/TLS and model/vector configuration remain deployment settings.

External fixture location relative to the Git folder: `../OPTASK_Messages/parsed`. Its manifest identifies 14 messages, 151 passages, 115 audit events and 462 preserved source records. It contains per-message JSON, NDJSON collections, per-passage JSON and Bulk API request files. Original raw files stay untouched. Subjects are null because these sources omit the email wrapper.

The loading guide in that directory contains explicit commands for a user-selected test endpoint. No server is started and no data is uploaded by this documentation task. Fixture dates are historical; the test index bodies deliberately install no operational retention policy. Applications reviewing these fixtures must use their original dates and review states, rather than rewriting them or presenting them as current operational orders.

The lexical profile can support UI development immediately after load. Semantic search requires a compatible installed local model, real embeddings, a chosen vector dimension/engine, and a hybrid search pipeline. Never seed invented vectors. Version-check hybrid filtering and pipeline APIs against the chosen OpenSearch release.

An array of ordinary objects can produce cross-fact matches, so use `nested` only where association matters. Disabled audit payloads remain retrievable from `_source` but unsearchable internally. Bulk actions succeed/fail independently and require per-item checking. References: [nested mappings](https://docs.opensearch.org/latest/mappings/supported-field-types/nested/), [object indexing controls](https://docs.opensearch.org/latest/mappings/supported-field-types/object/), [Bulk API](https://docs.opensearch.org/latest/api-reference/document-apis/bulk/), [hybrid query](https://docs.opensearch.org/latest/query-dsl/compound/hybrid/).

## 10. Compatibility and validation

The current schemas and new index definitions identify ICD 1.3.0. Consumers MUST reject unsupported major versions at the negotiated contract boundary. Unknown core fields fail structural validation; add fields/types through an explicit minor or major contract update and corresponding schema/mapping changes. Do not rely on dynamic OpenSearch mapping for compatibility. Audit payload internals can extend within their documented envelope without creating indexed fields.

Use [the validation tool](tools/validate_samples.py) with an external fixture directory. It validates local JSON Schema resources, all three document sets, data linkage, source hashes, source spans, frequency/time invariants, Bulk framing and audit evidence preservation. `jsonschema` is a build/test dependency, not a Rust runtime dependency; local/offline installations may supply it from prepared tooling.

Schema/type checks do not establish semantic correctness, host crash recovery, working auth/retention, model quality or actual OpenSearch compatibility. Report which of those were executed. SDK/registry compilation and live indexing remain separate implementation acceptance gates.

## 11. Outstanding deployment decisions

The following MUST be resolved before their dependent runtime behavior is enabled: actual CPU/RAM/disk budget; IMAP authentication, MIME/body encoding and multipart handling; command aliases/roster and C2 routing policy; unresolved/invalid/future issue-time handling; amendment/cancellation precedence; audit retention and cleanup; batch/queue resource limits; chosen OpenSearch/model/engine versions; UI auth/routes; production ISM partition/cutoff behavior; and recovery objectives.

These do not prevent teams from implementing schema-conformant pure parser logic and supplying fixture outputs under this ICD.

## 11. Geospatial extension (1.1.0)

Messages may include optional `locations`. Existing 1.0.0 payloads remain valid when it is absent. Each entry has a revision-scoped `g1`, `g2`, … ID, type, label, datum, datum source and inferred/unresolved status; optional `point` uses `{"lat": ..., "lon": ...}`, and `shape` uses GeoJSON longitude/latitude order for Point, LineString or Polygon. Circle centers retain their point and `radius_m`; no polygon approximation is manufactured. Scope remains optional. Evidence and coordinate tokens stay in audit linked by the location ID.

The user has authorized WGS84 as the default when a datum is absent. `datum_source` records `default` or `explicit`. Explicit other/unknown datums, invalid/checksum-failing coordinates and unresolved names retain `unresolved` entries without indexed geometry; no silent datum transformation occurs. Source-based area rings are closed and oriented for indexing. Spatial display/search does not establish command applicability or tasking.

The messages mapping uses nested `locations` with `point: geo_point` and `shape: geo_shape`; it keeps each geometry associated with its label, datum and status. Existing indices require an additive mapping update before receiving the field. See the [OpenSearch geopoint](https://docs.opensearch.org/latest/mappings/supported-field-types/geo-point/) and [geoshape](https://docs.opensearch.org/latest/mappings/supported-field-types/geo-shape/) contracts.

Named locations are valid source locations even when no coordinates are available. `locations.status=unresolved` describes unresolved map geometry, not an invalid name or failed message parse. Preserve the supplied name as the location label, omit unavailable geometry, and do not add a geospatial-review flag solely because the name cannot be plotted. Invalid coordinate/checksum/datum/topology cases remain separate. Parse completion and interpretation uncertainty are distinct presentation states.

## 12. CASREP addition (1.3.0)

Messages MAY carry a typed `casualty` object only when `type` is exactly `CASREP`.
Its fact ID uses the `q` prefix and participates in the same uniqueness, evidence
and output-budget checks as other facts. Absent objects MUST be omitted, not null.
CASREP creates no schedule activities from repair estimates. Date-only estimates
remain `YYYY-MM-DD` strings, without an inferred time or timezone.

CASLTY fields, action-specific required/prohibited sets and source evidence follow
[the CASREP integration contract](integration/casrep.md). Structured parts,
requisitions, receipt and publication arrays preserve their element relationships.
The passage's optional `casualty` is a compact filter projection, defined separately
as `casualtySearch`; it does not duplicate narratives or logistics arrays.
The derived casualty-history index is rebuildable and does not replace immutable
messages or imply operational validation. Consumers of the strict 1.1 schema must
upgrade before receiving CASREP fields; existing OPTASK documents remain valid.
