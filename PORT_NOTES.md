# Watch Desk multi-ship port — ready-to-paste PR descriptions

Port base: `60ac735`; polish base: `ad95629`. These are local PR drafts, not
publication. Each section below can be pasted into its slice PR. P5 watch changes
and P5b recurrence belong to a separate branch and are not claimed here.

Shared boundaries: synthetic demo bodies only in `backend/config/watchdesk-fixtures/`;
no automatic fixture submission, volume resets, production assignment inference or
new transmission capability. Ship selection is a view filter, not authorization.
New shared context writes resolve the current server session and require admin;
private draft writes remain owner-scoped. No credentials, generated bindings,
bundled framework files or dependency locks are changed by polish.

## P1 — Bounded Calendar review

### Summary

Restore a compact Needs review disclosure on Calendar. Unresolved facts stay out
of the time grid. Counts cover returned records only; unavailable, filtered,
limited and empty results remain distinct. Source links retain exact revisions,
fact IDs and the Calendar return URL. Failed refreshes hide stale source results.
Review placement is a product decision: the earlier removal of the Calendar list
was deliberate, and the current notification inbox does not produce schedule review.

### Files

Under `apps/watch-desk/ui/src/`: `components/calendar-review{,.test}.tsx`,
`pages/calendar.tsx` and `watchdesk-port.css` (styles moved here in the fixes slice).

### API contract

Consumes existing `meta.reviewItems` and `windowLimited` from messages/timeline.
No P1 server change. Missing source identity creates no borrowed link. Review does
not mean approval; even plotted extracted facts require operational confirmation.

### Tests

Added exact revision/return-link, missing source, empty/unavailable/limited/filter,
point separation and failed-refresh tests. Container execution is required;
static diff review alone does not establish runtime behavior.

### Screenshots to attach

Day/Week/Month review with two demo unresolved rows; filtered/empty/unavailable
states; source record and exact Calendar return; desktop light/dark and 400px.

### TODOs

A complete hidden-review count needs a bounded server projection. Do not infer
zero or subtract filtered pages. Copy improvements are in the polish slice.

### Questions for Parker

Keep review on Calendar, or implement a separate review destination? The current
inbox is not a substitute for unresolved schedule review.

## P2 — Explicit command roster and Ships sidebar

### Summary

Add four fictional commands plus Unassigned, grouped checkboxes, Only/select-all/
clear and URL-owned selection. Applicability comes only from explicit command IDs.
The shared synthetic fixture belongs to both Tern and Halyard; a fixture mentioning
ships but lacking assignment stays Unassigned. Chips are siblings of title controls.

### Files

- `backend/config/watchdesk-demo.json`, `backend/config/watchdesk-fixtures/*.txt`.
- Intake `src/{demo,config,service,lib}.rs`, `tests/custody.rs` (P2 only, not polish).
- Server `src/{commands,access,error,main,lib}.rs`, `tests/commands_contract.rs`.
- UI command roster, Ships sidebar, Calendar, DayTimeline, review, source-data,
  associated tests and port CSS.
- Final opt-in packaging: `compose.watchdesk-demo.yml` and default-off intake config.

### API contract

`POST /api/v1/commands/list {}` returns at most 32 commands with
id/name/shortLabel/group/colorIndex/isOwnShip and configuration provenance.
Authenticated read; strict unknown-field rejection; no roster-write API.
`ships` is a JSON array: absent means all; `[]` means none. Invalid/stale selections
never silently become all. Sender, recipients, unit and mentions are not authority.

Exact LF/CRLF decoded-body SHA-256 allowlists supply message-level command IDs only
when the demo is explicitly enabled. Changed bodies are new IDs, not amendments.
The audit outbox records assignment policy/configuration. No per-fact production
assignment or acknowledgement identity is inferred.

### Tests

Added allowlist hashes/line endings, changed-body denial, opt-in custody/audit,
command chips, URL/filter requests, roster failure and server-session role/actor
coverage. The title-control follow-up restored original assertions after reported
badge-text failures. Current container gates remain required after integration.

### Screenshots to attach

All ships, Only Halyard, Clear all, stale ship URL, both shared chips, Unassigned
with a named source participant, and demo-off empty roster.

### TODOs

Explicitly verify an isolated mailbox/destination before submitting the six demo
bodies. Use 5 Nov 2026 in Calendar. Resubmission into an existing database retains
old/new bodies; do not delete volumes or rewrite evidence to tidy a screenshot.
No persistent per-user ship preferences or production roster policy in this slice.

### Questions for Parker

What is the authoritative production roster/assignment policy (Q6)? Should absent
URL selection remain all, or eventually use explicit per-user preferences?

## P3 — Side-by-side Day

### Summary

Add Combined / Side by side for Day. Shared facts appear once per explicitly
assigned visible resource, without mutating the cached source. Combined/Week/Month
remain deduplicated. Collision partitioning runs per resource. Opening scroll uses
the earlier of first visible source time and now minus one hour, once per view/query;
manual scrolling is not repeatedly overridden by polling.

### Files

UI `components/{calendar-resources,day-timeline,calendar-viewport}`, their tests,
`pages/calendar.tsx`, port CSS. Fixture narrative additions and updated allowlist
hashes are in the P3 follow-up; no parser or publisher behavior changed there.

### API contract

UI-only `shipLayout=combined|side`, applied only to Day. Existing `ships` JSON and
Week `layout=expanded` retain their meanings. Source links preserve the whole URL.
No new API, timestamp/duration inference or permission change.

### Tests

Shared point duplication/deduplication, independent lanes, unchanged source objects,
empty/invalid selection, exact source returns and Week ignoring Side. Opening-scroll
and width policy tests. Synthetic oracle: four intervals, three points and two
unresolved times; resolved facts occur on 5 Nov 2026. Narrative passage eligibility
is tested separately from successful embedding/publication.

### Screenshots to attach

## P5 — Since last watch by sent time (DTG)

- **Files:** server `changes.rs`, route/module wiring, `tests/changes.rs` and session
  contract tests; UI `watch-boundary.ts`, `watch-changes.ts`, `watch-turnover-panel.tsx`,
  tests, Calendar integration, shared ship-filter helper and port-only CSS.
  `commands/list` now exposes the stored UTC turnover schedule without another
  identity/settings query in Calendar.
- **API:** authenticated read-only `POST /api/v1/changes/list` with ISO UTC
  `{since,until,filters?,before?,watermark?}`. Bounds are `[since,until)`, positive,
  at most 42 days, with millisecond request precision. Strict fields; no actor/role
  input and no new application write. Two concurrent read jobs, seven-second read
  deadline, 2 MiB output cap. No raw-body transfer or OpenSearch fan-out.
- **Time basis:** messages are windowed and ordered by **source issue time** (`issued_at`,
  the message DTG): when the originator sent it. First receipt time is returned as
  `recordedAt` and shown beneath as "Received …" custody metadata only. Messages with no
  issue time in source are listed separately, outside watch counts. Repeated receipts or
  parser revisions do not create another entry; a changed body is a separate message,
  not an amendment. Paging uses the receipt-sequence cursor; each page is sorted newest
  sent first.
- **Citations:** first receipt ID/time and the exact first-receipt revision when it
  has a published projection. If that revision is unavailable, no fallback revision
  link is fabricated. Explicit projection `command_ids` alone determine visibility;
  source metadata uses that original projection where present, otherwise the latest
  published projection. Shared records remain single records, not per-ship copies.
- **Bounds/unknowns:** up to 200 candidate rows per page, descending receipt sequence,
  with a receipt watermark and exclusive `before` cursor. Near-boundary candidates
  excluded by the exact comparison still advance the cursor. Counts cover returned
  pages; hidden counts never imply a whole-watch total. Up to 50 unknown-time records
  are separate, outside date counts; unknown clipping is labelled. Unavailable is
  distinct from empty. Amendment/cancellation/review-transition producers remain
  **not available**, not zero. No optional inbox producer was added; undated evidence
  cannot create a turnover bell signal through this slice.
- **UI:** collapsed automatic watch by default, configured UTC boundaries inclusive
  at turnover, validated `05 NOV 2026 1600Z` picker (optional seconds/milliseconds),
  pinned ISO URL or `closed:<auto|ISO>` preserving the selection. Invalid input does
  not change URL/counts. Automatic watch requires available context, not a fabricated
  fallback. Ship filters apply; calendar search/scheduled date do not filter custody
  history. Show clears ship/search URL filters without storing preferences. Exact
  source links open Lifecycle and preserve Calendar return state. Turnover URL edits
  no longer retrigger calendar opening scroll. A 30-second clock refresh resets the
  bounded read/paging window; durable incremental watch snapshots are deferred.
- **Tests added:** exact boundaries and submillisecond edges, shared/hidden/none,
  unknown times, duplicate/revision deduplication, absent source revision, pagination
  watermark and strict requests; HTTP authentication/unavailable versus empty;
  rendered UTC validation, source/return links, hidden Show, unknown separation and
  unavailable UI. Existing console-error guard stays enabled; network/React work is
  mocked and settled.
- **Validation here:** static diff check and in-memory Node SQLite checks for coarse
  SQL bounds, cursor/unknown partition and exact revision links. Rust exact-time
  logic, TypeScript, UI and live screens have **not** been run here; Claude's container
  gate remains required. No builds, application tests, fixture loading or volume resets.
- **TODOs:** authoritative amendment/cancellation/review-transition lineage, optional
  dated-only inbox integration, retention and stable cross-poll pagination. Existing
  demo read authorization applies; this is not a production command ACL implementation.

## P5b — Source-anchored recurrence (Addenda R/R2)

- **Contract:** ICD 1.2.0 adds optional `message.recurrences` and `rN` fact IDs, with
  `type`, RRULE `rule`, explicit `dtstart`, optional `until`/`count`, `exdates`,
  `activity_id`, scope/status. Existing activity fields and IDs are unchanged.
  Schema → generator → Rust DTOs/validation → bounded SDK sink/host → nested mapping.
  Rule/source-span provenance stays in `fact_interpreted` audit, not core. No new
  crate, dependency, lockfile, Settings UI or general CSS changes.
- **Real hook:** `optask/crypto_recurrence.rs` collects baseline daily-shift activity
  evidence and emits companion facts after ordinary parsing. Descriptor version is
  0.3.0. Exactly one unambiguous message-wide PERIOD must have a fully explicit
  source start (including year) and complete end or declared UFN. No period, missing
  source date/zone, receipt-year-defaulted period, or multiple message-wide periods
  leave the original activity unresolved. The original activity is not mutated.
  `optask.crypto.recurrence.v1` cites the existing crypto locator plus both source
  record spans and activity/period IDs. Periods occurring later in the message work.
- **Synthetic path:** demo-only wrapper `optask-watchdesk-demo` delegates real parsing
  unchanged and emits one exact-hash-allowlisted radio-check companion. New
  `recurring-radio.txt`: Tern + Halyard, 0800Z/2000Z on 05–08 NOV 2026. New
  `baseline-crypto.txt`: Meridian, baseline CRYPTDAT 1330Z with the explicit period.
  The latter receives an explicitly configured, **unvalidated fictional-only**
  security override because baseline headers lack a marking; no other body gains
  that policy. The existing demo assignment audit records this exception. Demo flag
  off means no wrapper/assignment/security override. `watchdesk-demo-v3` includes
  both LF/CRLF hashes; original six bodies/hashes are unchanged. No fixtures loaded.
- **Expansion:** new server `recurrence.rs`, no RFC crate. Zulu HOURLY/DAILY/WEEKLY,
  positive INTERVAL, BYHOUR/BYMINUTE, unnumbered weekly BYDAY, COUNT/UNTIL and EXDATE.
  Monday-based weekly phase; inclusive UNTIL; half-open request window; COUNT is
  consumed before exclusions. Unsupported parts/combinations and absent anchors
  produce visible review, never a clock/issue/receipt anchor. Open-ended rules are
  marked ongoing. Closed-form seeking/counting avoids walking from an old anchor.
  Maximum request window 42 days; output consumes the existing shared 2,048-fact
  bound and fails explicitly rather than presenting an unlabelled truncated watch.
- **Important bounded-rule convention:** R2's `dtstart` is a source-period lower
  bound/phase anchor. Do not emit midnight when the daily check is 0800Z. Only
  matching clock positions count. This defines the nonmatching-DTSTART case that
  RFC 5545 leaves undefined; it is a documented subset rule convention, not a full
  iCalendar component implementation. Durations are not invented: these occurrences
  are points. Each presentation ID is `rN@UTC-instant`; `sourceFactId=rN` retains the
  audited rule identity. No occurrence amendment/cancellation/ack write is added.
- **Timeline/index:** source selection now includes recurrence-only/unanchored
  records in every view, still under the existing 100-message bound and limited
  label. The publisher checks existing schema/mapping then adds only the recurrence
  field and updates version metadata, preserving other properties/metadata and
  index identity. Unknown/incompatible mappings require operator migration; no
  delete/recreate/reset. Fresh definitions use 1.2. Existing older strict readers
  require coordinated upgrade before receiving new fields.
- **UI-only changes:** `source-data.ts` metadata and `day-timeline.tsx` occurrence
  identity, ↻ marker, plain-language rule tooltip/Week details, exact source link.
  Week index keys use full source-event identity instead of the missing legacy
  numeric ID shared by new occurrences. Day/Week/Month/side tests added. No P6 polish.
- **Tests:** pure expansion boundaries, source-period lower bound, inclusive UNTIL,
  global COUNT/exclusions, old hourly anchors, Monday phase, property-style window
  partitions, unsupported/unanchored review, shared fact bound and stable IDs;
  baseline activity byte-equality/source audit checks; exact demo intake and security
  opt-in; fixture hashes and all calendar views. Parker must run ignored
  `external_optask_regression` against his external samples; those were not accessed.
- **Validation/status:** static JSON/ref/mapping-field/hash checks (eight LF/CRLF
  fixtures), Python AST and diff checks passed. DTOs were regenerated with rustfmt
  in the toolchain container; the +79-line generated diff was reviewed against the
  schema, including unchanged existing activity declarations. Rust/UI/tsc/live gates
  remain outstanding. Generation is not application or indexing validation.
- **Deployment/TODO:** do not reinterpret previously published baseline bodies under
  an old revision. New fictional bodies do not require resetting the current journal;
  production reprocessing needs an explicit new host revision and controlled journal
  migration/isolation, not edits to its identity guard. **Parker to map real OPTASK
  sets (other crypto forms, recurring COMCHECK) to this fact.** Full RFC 5545, local
  timezone/DST rules, ambiguous period precedence, duration recurrence, durable
  occurrence edits/cancellation/ack targeting, retention and audit history are deferred.

## Remaining ownership

P5 is committed as `9577a82`. This agent finishes P5b as one commit, then stops.
All P6 polish below is delegated to a second agent on a separate branch. Coordinate
its `day-timeline.tsx`/search-template changes with the minimal recurrence wiring.

Verify publication/embedding of the four synthetic narrative additions, not only
model health. Polish supersedes the initial fixed-width fit policy with readable
lane floors and an explicit overflow indication. No Week resource layout added.

Sonnet's live review at `e4c7ddc`, in priority order (the supplied `/tmp/claude-1000/
computer-use.0ZEvmL/out/report.md` is not mounted here; this records Neal's summary):

1. Month: 05 NOV shows one event and a clipped second; the `+4 more` control is
   clipped/inaccessible. Keep show-more visible/clickable regardless of cell overflow.
2. Burst typing in Calendar search keeps only the last character (`q=s`); 20ms gaps
   work. Check controlled-input/navigation timing and `update()` snapshots, including
   `60ac735`, before attributing a cause. Fix inherited behavior too and note ownership.
3. Search `communications` hides two matching visible titles; `radio rehearsal`
   returns the same set. Verify indexing/query fields and hard-coded hybrid behavior;
   show the executed mode. Do not treat semantic top-k as a match predicate for every
   query. A lexical requirement / calibrated semantic threshold is Parker's policy
   call; no arbitrary relevance threshold is approved by this report.
4. Clear all in Combined must say “No ships selected”, not a blank grid beside an
   apparent all-clear review message. Keep explicit none fail-closed in every view.
5. At 400px, collapse Ships initially and keep roughly 420px minimum calendar height;
   prevent header clock/bell overlap. Open disclosure currently leaves a 16px grid.
6. Week lane labels reach 1–2 characters at 1280–1440px. Prefer ellipsis + full tooltip
   or a bounded minimum lane width / overflow indicator, preserving seven-day Fit.
7. Verify server authorization for Send Acknowledgement. Do not infer its policy
   from Settings admin permissions. If ordinary users cannot send, disable with a
   reason; otherwise explain the actual authorization rather than inventing a ban.
8. Note only: reported dev React bundle / ~20k profiling logs. Inspect production
   builder invocation/configuration; it may be the container build, not app code.
   Do not edit the read-only Ark pipeline to hide symptoms.

- Neal confirmed `e4c7ddc` column fitting and source-first opening scroll on the live
  Rust/OpenSearch stack. Screenshots: `specs/watchdesk/port/e4c7ddc/` in the handoff repo.
- Per-ship collision labels still become “communi” around 1400Z. Prefer readable
  stacking/minimum ~120px label width with ellipsis/full-title tooltip, without
  moving source instants or reintroducing seven-day/five-column overflow.
- Add ship-tinted fill/header chips so identity is more than a thin rule; keep amber
  reserved for review/revised. Preserve title-only link/button textContent.
- Needs-review copy should explain missing information, e.g. “No date in source:
  1200Z–1800Z (day not given) · not plotted · open source”, using typed reason codes
  and available source time text. Current `meta.reviewItems` has only a generic
  reason; inspect canonical clock/status fields before adding small presentation
  fields. Do not present normalized clock values as verbatim raw source text or
  fan out raw-body reads. Document the exact server-field seam for Parker.
- Undated review stays independent of Day/Week/Month. Explain: “Dates are unknown,
  so these items are shown in every calendar view until resolved.” Verify the server
  query as well as the component; calendar view bounds must not silently drop them.
