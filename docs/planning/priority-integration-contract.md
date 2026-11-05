# Priority integration contract — v3

Task routing, ANCHOR history and PB4T planning extend one shared workflow.
See [the integration record](../integration/anchor-pb4t-calendar.md) for the
current-main integration, validation and limitations. This contract originated
in the completed Agent 1–3 prototype and is retained as the shared API boundary.

## Identity and evidence

- Exact source content: `sha256:<64 lowercase hex>` over the decoded UTF-8 body.
- Canonical interpretation: `<source ID>@<parser revision>`. Parser revision is
  not amendment lineage. Fact IDs such as `a1` are scoped to that exact key.
- `SourceRef`: `messageKey`, nullable `factId` (null is a message-level reference). Readable
  evidence uses the existing `/api/v1/messages/detail` and `/evidence` endpoints with that exact
  key/fact.
- Scenario: `meridian-2026-11-10`. Its explicit source bindings are in
  `backend/config/priority-1/sources.json`. Each binding supplies a stable
  `logicalEventId`; no relationship is inferred from arrival order or body hash.
- Task: `<logicalEventId>:review`. `eventVersion` starts at `1` and identifies the
  current source/event interpretation. `version` is a separate task mutation
  counter. `schemaVersion` is the persisted record schema version.

## One atomic workflow aggregate

Hidden application state kind `priority_workflow`, key `meridian-2026-11-10`.
The aggregate contains scenario clock, task map, routing configuration, and
`extensions` (initially `{}`). Source bodies and parser facts remain immutable
in the existing message/audit stores; private drafts remain in private state.

Every mutation reads the aggregate and uses `Store::put(record, Some(document))`
with OpenSearch sequence/primary-term CAS. Conflicts return HTTP 409; clients
reload. Do not retry a human decision against newly changed inputs silently.
Ingestion retries may reload and only add absent stable task IDs. Replays never
reset assignment, review, progress, history, clock, or extensions.

ANCHOR stores declarations/evidence in `extensions.lineage` and updates the task's
`source`, `eventVersion`, progress, review requirement and reminder fields in the
same CAS. Agent 3 owns `extensions.planning`, validating all current event/person/plan
versions inside that same CAS. Every caller must preserve unrelated extensions.

## Task and decisions

A task has action, command ID, responsibility profile ID/name, local owner
account ID/name and optional fictional person ID, source reference, event
interval, due time/basis, routing reason/rule ID, original review flags,
`progress` (`not_started`, `in_progress`, `completed`), reviews and history.
Source POCs are shown separately and never determine local ownership.

Internal review records contain authenticated actor, responsibility ID, exact source reference,
`eventVersion`, optional `currentVersionToken`, and actual UTC `recordedAt`. Repeating review by the
same actor for that version is idempotent. Review does not complete a task, validate parsed facts,
or send a formal message. Decision history records actor, actual time, action, reason, and
before/after envelopes containing source, event version, task version and assignment or progress
state. History capacity fails closed; prior decisions are never silently discarded.

## Authorization

All operations require existing native identity and an active `schedule:read` account. Every
returned task and mutation checks all declared history sources, including future and unresolved
links, against server-enforced command/category scope before checking version tokens. A hidden
history cannot leak through stale-token errors. Matching OPS/Engineering labels confer no
authentication privileges. Existing administrators coordinate setup, clock changes and reassignment.
Only administrators or the exact designated owner account may review or change progress.
Reassignment checks the target's active account and source scope; null explicitly leaves the task
unassigned. Readers may inspect shared work within their source scope. Hidden work is not included
in counts. Disabled accounts cannot mutate. No outbound service is used.

## Scenario time and authored inputs

`extensions.clockHistory` retains clock decisions with authenticated actor, actual
recording time, before/after scenario time and input aggregate version.

All scenario times are November 10, 2026 UTC. Initial clock `08:15`; overdue
demonstration `09:01`. Decision timestamps use actual server UTC and remain
separate from source issue/arrival/scenario time. The original source contains
09:00–09:45. Review deadline 09:00 comes from **Local demo policy**, not the
source event's start. Unknown deadlines remain null. Personnel P-01, exact
command applicability and routing rules are separately authored demonstration
records, not extracted source claims.

## HTTP shapes

Same-origin JSON `POST /api/v1/work/{operation}`. Requests reject unknown fields.

- `setup {}`: admin, explicitly local-demo only; creates idempotent scenario,
  OPS/Engineering responsibility records, and designated local-demo owner.
- `list {}`: reads real canonical sources from the four exact fixture bindings,
  materializes supported tasks idempotently, then returns only scoped tasks.
  Missing source records are reported as pending; service failures fail the read.
- `review {taskId, expectedVersion, eventVersion, currentVersionToken?}`: exact-version internal
  review; token required for managed ANCHOR events.
- `progress {taskId, expectedVersion, eventVersion, currentVersionToken?, progress, reason}`: token
  required for managed ANCHOR events.
- `assign {taskId, expectedVersion, eventVersion, ownerId, reason}`: admin;
  `ownerId: null` means unassigned. Returns the updated task.
- `clock {scenarioNow, expectedVersion}`: admin; aggregate version is required.
  Time is monotonic; use a new isolated state index to restart a demonstration.
  Effective lineage changes reconcile atomically before the clock write.

List returns `scenarioId`, `scenarioNow`, `version` (aggregate), `configured`,
`canCoordinate`, `items` (tasks plus `canAct`, `reviewed`, `overdue`), and
`pendingSources` (coordinators only). Mutations return `{item}` or clock state.
Bounds: four configured sources, three initial tasks, 256 history entries per
task, 64 review records per task, 1 MiB aggregate. A failed read is never a claim
that the queue is empty. No fixture fallback or second backend is permitted.

## ANCHOR explicit history and current-event contract

`anchor_lineage.rs` is a pure, bounded resolver; `anchor.rs` owns persistence,
authorization, shared task reconciliation and HTTP presentation. Only the existing
logical event `meridian-2026-11-10:original` is registered in this first slice.
Maximum 32 immutable declarations. There is no language-based relationship inference.

Each declaration has a unique local `id`, exact `source {messageKey, contentHash, factId}`,
`relationship {kind: original|amends|cancels, target?}`, `effectiveAt`, whole selected-event
`interval` (nullable), authored `provenance`, and preserved `parsedReviewRequired`. The server reads
source evidence and intervals from the canonical parser output; callers cannot submit replacement
facts. Cancellation selects a real message with `factId:null`. Source evidence, actual actor and
recording time are retained separately in
`extensions.lineage.events[logicalEventId].evidence[versionId]`. The canonical message, facts and
parser review flags are never edited.

`CurrentEvent` / JSON event view:

- `logicalEventId`, `status` (`active`, `cancelled`, `pending`, `unresolved`).
- `versionToken`: opaque SHA-256 token of the exact effective declaration path;
  null if no unambiguous current instruction exists. `current`, `original`,
  `previous`, ordered `history`, `nextEffectiveAt`, and machine-readable `problems`.
- Each selected version contains exact source identity, interval, relationship,
  effective time, provenance and parser review requirement.
- HTTP views add `taskId`, `taskVersion`, `eventVersion`, `canReview`, `reviewed`,
  existing `reviews` and per-version evidence. Task JSON also adds `currentEvent`,
  `currentVersionToken`, `instructionStatus` and `remindersActive`.

`eventVersion` is path depth (original 1, amendment 2, cancellation 3), not a safe
planning fingerprint. **PB4T must compare `versionToken`**, status and exact source,
plus its personnel/local-plan input versions, inside the aggregate CAS. Adding a
future declaration does not alter the effective token or invalidate review until
its effective time. Assignment/review mutations change workflow/task counters but
not the event token. Same-depth replacement branches cannot reuse a token.

Missing targets, cycles, invalid ordering, conflicting IDs and effective sibling
branches fail closed to `unresolved`; there is no arrival-order winner. Future
valid branches conflict only when effective. Cancellation is terminal. Replay of
a superseded declaration cannot resurrect it. Duplicate identical declarations
are authorized no-ops, including with stale `expectedVersion`; different content
under the same declaration ID is rejected. Human decisions never silently retry.

Initial ANCHOR registration preserves Agent 1 review/progress. A later effective
material change preserves all reviews/decisions and owner, replaces only the
selected task source/event, resets progress and requires a new review. Existing
Agent 1 reviews without a token count for the unchanged original only; new managed
reviews require the exact token plus task and event counters. Cancellation keeps
the same task as cancellation-review work, clears due time/reminders, and removes
the interval. Internal review never completes work, validates facts or sends mail.

Same-origin authenticated JSON routes (unknown fields rejected):

- `POST /api/v1/anchor/current {messageKey?}`: scoped current views; response
  `{scenarioId,scenarioNow,version,configured,complete,coverage,items}`. Optional
  exact message key selects histories containing that source and is scope-checked.
- `POST /api/v1/anchor/setup {expectedVersion}`: Admin, local-demo only; register
  the existing original task as declaration `original`, effective 08:00 UTC.
- `POST /api/v1/anchor/declare {expectedVersion,logicalEventId,versionId,
  source:{messageKey,factId},relationship:{kind:amends|cancels,target},effectiveAt,
  provenance}`: Admin; requires the configured synthetic workflow and uses real
  readable canonical evidence.
  Response `{configured,duplicate,version,item}`. No actor or parsed interval input.

`complete` and `coverage` describe only the bounded registered managed set, not
all calendars, all messages, or a personnel schedule. Unresolved/pending history,
unknown active interval, hidden history or unconfigured state are incomplete.
Cancelled events can be complete with no interval. A message-filtered response
is not a complete planning input. PB4T must call the unfiltered shared view and
check its separately declared schedule coverage. Service errors are errors.

Rust integration points for Agent 3:

- `anchor::current_views(&Workflow)` and `current_view(&Workflow, logicalEventId)`.
- `CurrentEvent::scheduling_interval()` yields an interval only when active.
- `anchor::authorize_event(app, identity, event)` rejects empty resolved history
  immediately. For nonempty views it checks every stored history source.
- `anchor::event_view(workflow, identity, event)` formats JSON **after authorization**.
- `work::load` / `save` retain the same sequence/primary-term CAS boundary.
  Load once, authorize, resolve/revalidate inputs, update only planning, increment
  aggregate version, save once. Reject stale inputs and CAS conflicts.

## Calendar and source-reader projection

Canonical timeline overlays the same resolved current event and returns its view
in `meta.currentEvents`; reader requests `/anchor/current` for the exact source;
queue embeds the same view. Old selected facts are suppressed by exact
`(messageKey,factId)` pairs, including unresolved declarations. The synthetic
priority-2 manifest explicitly reserves the amendment/conflict `a1` facts before
registration so mere arrival cannot schedule candidate instructions. These are
withheld candidates pending explicit linkage, not inferred active amendments.
Unrelated `a2`, another source, and another parser revision remain untouched.

The resolver's registered set is loaded independently of the calendar time/search
prequery. This lets a moved event appear in its new time window even if the old
source time lies outside it. Search can match any declared source; ordinary filters
and all source-scope checks still apply. Cancelled history remains visible on the
affected date while no active interval is emitted. Calendar bounds/truncation
remain explicit; PB4T must not use a truncated calendar response as full coverage.

## PB4T personnel planning and local decisions

`pb4t/calculation.rs` evaluates declared constraints without I/O;
`pb4t/state.rs` owns proposals and decisions; `pb4t/mod.rs` connects them to the
existing application, authorization and workflow CAS. State lives only in
`extensions.planning`. Setup reads `backend/config/priority-3/personnel.json`;
it does not modify canonical messages, parser facts, lineage, task progress or
private drafts.

The bounded scenario explicitly assigns fictional P-01 to the current Meridian
communications event and local training. The command/responsibility directory
is not a qualification roster. Personnel qualifications, availability, the
training plan and move rules are separately authored records. Complete coverage
is declared only for this person's scenario assignments, 09:00–12:00 UTC on
November 10, 2026; it is not inferred from the calendar query or all command work.

PB4T resolves `anchor::current_view(&workflow, anchor::EVENT)` from the loaded
aggregate. An active event uses only `CurrentEvent::scheduling_interval()` and
its exact `versionToken`/source. Pending or unresolved intervals never fall back
to task times. Cancellation removes that fixed event from the calculation and
preserves the local training plan. A known future declaration effective at or
before the coverage end makes the assessment incomplete until recalculation
against the effective version. Missing workflow/history or unavailable evidence
is an error, not an empty or clear schedule.

Assessment status is `clear`, `feasible`, `no_feasible_slot` or `incomplete`.
Intervals are half-open, so adjacency is compatible without an explicit buffer.
Collisions require shared actual person IDs; matching names/role labels do not
suffice. The checker considers every assigned person's qualifications and full
availability, duration, all other events, fixed-event preservation, move window,
later starts on the UTC daily grid, and optional before/after buffers. Buffers
expand both occupied time and required availability. Exact duplicate records
collapse; conflicting duplicates fail incomplete.

The original 09:00–09:45 communications interval is clear of training. The
amendment at 10:30–11:15 overlaps training 10:45–11:15 for P-01. With 30-minute
training, a 15-minute grid, a 09:00–12:00 move window and no declared buffers,
the first feasible alternative is 11:15–11:45 after checking 10:45, 11:00 and
11:15. “No feasible slot under the declared move rules” is returned only after
exhausting permitted starts. Missing/unresolved inputs, stale roster validity,
incomplete coverage, oversized inputs and an interrupted search produce
`incomplete`. Source-directed events remain unvalidated in this slice, so their
calculations are explicitly provisional; internal review does not certify them.

Planning state contains separate `version`, `rosterVersion`, `planVersion`,
people/freshness times, the local event, move rules/coverage, proposals and
decisions. Each proposal retains its complete inputs, assessment, alternative,
authenticated actor, actual creation time, status and `inputVersion`. This
`pb4t:<sha256>` digest binds roster/local-plan versions, all calculation inputs
(including scenario time, rules and coverage), and ANCHOR's current token.
It is not the numeric task `eventVersion`.

Same-origin authenticated JSON `POST /api/v1/planning/{operation}` rejects
unknown request fields and returns the planning view:

| Operation | Request | Behavior |
| --- | --- | --- |
| `read` | `{}` | Scoped current inputs, assessment, proposals and decisions. |
| `setup` | `{expectedVersion}` | Admin/local-demo only; initializes authored personnel once, preserving an existing plan. Requires work and ANCHOR setup first. |
| `propose` | `{expectedVersion}` | Admin; recalculates and persists a feasible alternative. Repeating unchanged inputs reuses the pending proposal identity. |
| `decide` | `{expectedVersion, proposalId, decision, reason?}` | Admin; `decision` is `accept` or `reject`. Requires a pending proposal matching current inputs. |
| `personnel` | `{expectedVersion, people, rosterObservedAt, rosterValidUntil}` | Admin; bounded personnel update increments roster/planning versions and invalidates older input digests. |

`expectedVersion` is the shared workflow aggregate version. Responses contain
`configured`, `canCoordinate`, `version`, `scenarioNow`, `scenarioId`, `inputs`,
`assessment`, `proposals`, `decisions`, `currentEvent`, `inputVersion` and
`datasetBasis`. Reads require an active `schedule:read` account and access to
every current/history source and retained proposal source. All mutations require
the existing Admin privilege; operational role names grant nothing. Actor and
actual recording time come from the server and are not request fields.

Acceptance resolves and authorizes current inputs, compares aggregate and input
versions, reruns the constraint check, changes only the local training interval
and `local-plan:<version>`, and appends the decision before one CAS save. The
decision records actor/time/reason, proposal/input version and input roster/plan
versions. Rejection appends its decision without changing any schedule event.
Both preserve proposal evidence and unrelated workflow extensions. Intervening
aggregate writes return 409; changed planning inputs require a new calculation.
There is no silent retry of a human decision against changed inputs.

Bounds are 64 people, 128 events and at most 4,096 candidate starts per
calculation; 64 proposals and 256 decisions per plan; the shared 1 MiB aggregate
limit also applies. Bounds fail closed without dropping prior history. The
personnel endpoint also bounds qualification/availability arrays and text sizes;
the existing HTTP body limit remains in force. Unsupported JSON constraints are
rejected rather than ignored.

The canonical Calendar contains a Personnel planning panel with both events,
person/qualifications/availability, exact source link, overlap, explanation,
saved proposal and decision history. Local training is displayed as a local
plan, not a fabricated parsed message event. The `pb4t` query is bound to account
and effective source scope. Planning mutations invalidate `pb4t`, `assigned-work`,
`anchor-current` and `parse-command-source`; work mutations also invalidate
`pb4t`. Refetch follows calendar refresh settings/focus/reconnect. Failed reads
hide cached actionable plans; changed digests disable stale decisions.

Replay/answer key: [priority-3 README](../../backend/config/priority-3/README.md).
Actual checks and remaining gaps: [integration record](../integration/anchor-pb4t-calendar.md).
