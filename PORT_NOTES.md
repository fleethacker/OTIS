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

All five resources, Tern + Halyard shared fact in Side and Combined, first useful
opening time, dense lanes and source return at 1280/1440px; mobile overflow and zoom.

### TODOs

Verify publication/embedding of the four synthetic narrative additions, not only
model health. Polish supersedes the initial fixed-width fit policy with readable
lane floors and an explicit overflow indication. No Week resource layout added.

### Questions for Parker

Accept dense-column horizontal scrolling in exchange for readable lane labels?
Should resource comparison remain Day-only?

## P4 — Admin watch context and cited Settings

### Summary

Add app-wide display context and Settings provenance. Own ship, display-name override,
group/command, visible defaults and UTC turnovers are explicit/manual. Only operation/
exercise has source suggestions. No confirmed value is automatically overwritten.
Read-only users can inspect values/citations; shared writes require current admin
permission. Header links retain Calendar return context.

### Files

Server `src/{watch_context,context_metadata,commands,private,main,lib}.rs`,
`tests/commands_contract.rs`; UI Settings/tests, watch-context/header, navigation,
Ships sidebar, command-roster and port CSS. Route registry is generated by the
bundled generator, not manually authored. No protobuf/ENT changes.

### API contract

- `POST /api/v1/watch-context/get {includeSuggestions?:boolean}` returns context,
  per-field confirmations, server actor/time, canEdit and bounded suggestion metadata.
- Original update: `{field,values,confirmHideUnassigned?}` or
  `{suggestionId,dismiss?}`. Polish adds atomic `{changes:[...]}`; see below.
- Server-session admin required (user 403, no session 401). Actor/role in JSON is
  rejected. A singleton private SQLite document stores last-write-wins state;
  no `expectedRevision`, durable edit audit or optimistic-conflict UI in this base.
- Suggestions inspect at most 200 published records / 400 metadata fields, group
  at most 20 values with 20 verified citations each, and verify UTF-8 source spans.
  No bodies cross this metadata boundary and no detail fan-out occurs. Use recomputes
  source evidence server-side; Dismiss is independent. Context reads without
  suggestions skip metadata work. Failure/timeout degrades suggestions, not manual edits.
- Hiding Unassigned defaults requires explicit confirmation. Defaults apply only
  through Use app defaults, not through silent URL hydration.

### Tests

Admin/user/no-session writes and durable actor, forged payloads, visibility guard,
grouped Use/Dismiss, Unicode line bounds/corrupt spans/caps, missing citation arrays,
read-only UI and revoked-write draft preservation. Earlier container report at
`aea938d`: UI 83/83 and TypeScript passed, Rust failed checked integer reads;
`e9356e7` fixes that conversion. Current integration gates remain required.

### Screenshots to attach

Settings pristine/confirmed, source citations/conflicting suggestions, user read-only,
admin revoked-write error with draft retained, header context and demo-off defaults.

### TODOs

Audit history, concurrency conflicts, retention and production command authority.
User lifecycle is a separate integration: preserve `App::headers_identity` and
`access::require_admin`; never use browser roles/ship preferences as authorization.
Session disable/revoke/role removal must be effective on the next server write.

### Questions for Parker

Accept changed-fields last-write-wins for this demo? What are the production own-unit,
group and display-override contracts? Where should audit/conflict UX live?

## Fixes — Demo scope, bounded metadata and validation follow-ups

### Summary

Gate fictional roster/context on effective demo configuration; default is off.
Suppress out-of-roster stored values in responses without destructive reads.
Bound source suggestion jobs (seven seconds, at most two workers); context writers
are awaited and recheck admin authority rather than timing out in the background.
Read SQLite integers as signed and convert citation bounds with checked conversion.
Keep original title-only event controls, regenerate Settings route correctly and
isolate port styles from the base stylesheet.

### Files

`compose.watchdesk-demo.yml`, default intake config, server watch_context/
context_metadata/commands and tests; UI generated route output, header, command
chips, layout/tests and `watchdesk-port.css`. The generator/framework is unchanged.
See commits `9b8ee50`, `e9356e7`, `ad95629` for the original follow-ups.

### API contract

Demo opt-in uses server-only `PARSE_COMMAND_WATCHDESK_DEMO=true`. Off returns no
fictional own ship/roster. Stored out-of-scope context is not erased. Enabling does
not backfill canonical assignments, reparse messages or reset data. Metadata timeouts
return unavailable suggestions while manual context remains readable/editable.

### Tests

Demo on/off, stored-context suppression without destruction, session API checks,
slow/unavailable suggestions, UTF-8 bounds, Fit/Expanded widths and command badges.
Static JSON/hash/diff checks were recorded for original slices; container gates
remain necessary. No healthcheck alone proves a working source adapter.

### Screenshots to attach

Demo-off header/Settings, enabled roster, unavailable suggestions with usable manual
form, all routes including Settings, original title-only event links and Week modes.

### TODOs

Canonical Ark generation/checks plus base/compatibility/demo Compose validation in
containers. Never modify protected pipeline or reuse a shared database for journeys.
The earlier L9 finding was not supplied; no mechanism or fix is claimed for it.

### Questions for Parker

Confirm production defaults when no roster is configured. Confirm Calendar review
placement and the later readable-lane policy before merging presentation changes.

## Polish — Settings, discoverability and readable calendars

### Summary

1. One Settings form: Save settings sends only changed fields; Cancel resets to the
   latest loaded values. Dirty/unchanged/pending states are explicit. Failed writes
   and refresh preserve drafts. Use/Dismiss remain separate and wait for manual edits.
2. Month uses identical 24px dummy/real event heights, single-line chips/titles and a
   620px month floor so show-more stays inside its row and can open the popup.
3. Calendar input is synchronous while URL navigation transitions; updates compose
   from latest params and Back/Forward restores routed state. Source inspection
   confirms the same stale URL-controlled pattern at `60ac735`; base was not run here.
4. Keep the single hybrid search box and existing server ranking/filtering. Calendar
   and Messages show the returned executed mode as plain text only, never infer it
   from the request. No UI mode selector, local lexical union, extra keyword request,
   Related section or similarity threshold is implemented. Search quality is an open
   server-side question below, not a ranking change in this slice.
5. No ships selected is explicit in every layout; no source/search request or “all
   clear” review claim is made for none. Filtered empty review has distinct copy.
6. Review explains missing date/zone/year/end, open end or invalid interval using
   canonical status and available labels. Normalized clocks are labelled as such,
   never represented as verbatim source tokens. Undated view independence is explained.
7. Ships defaults collapsed only when a positive narrow viewport matches (<=900px).
   Mobile scrolls the page instead of crushing the time grid; ~420px floor and separate
   header clock row prevent grid/footer/notification collisions. Header contrast improves.
8. Fit Week widens only busy days to 128px per visual lane; Side Day reserves lane
   width too. Dense views scroll internally with explicit controls. Full-title/time
   tooltips, Week details/index and source instants remain unchanged. Expanded retains
   equal lane-proportional columns. This trades all-columns-at-once fit for legibility.
9. Side headers have ship-tinted chips and events have subtle ship fill. Named ships
   never use amber; review/revised cues retain it. Unassigned is labelled explicitly.
10. Authorization check: the enabled Send Acknowledgement control opens a private
    preparation modal, calls SavePreparation(generate=true), and offers Copy draft.
    It does not send mail. `rpc.rs::scope` checks session/same-origin/source revision
    and uses server username for private ownership; `user` is allowed, so the control
    stays enabled. Separate RecordAcknowledgement requires confirmation of an external
    event and also transmits nothing. No live write was attempted for this check.

### Files

UI Calendar/Settings/Messages, calendar-params/search/review/review-time, ShipsSidebar,
DayTimeline, calendar-viewport, watch-context/source-data, port CSS and their tests;
monthly popup journey assertion. Server changes are limited to `watch_context.rs`,
`presentation.rs`, one execution-metadata forwarding hunk in `api.rs::timeline`,
and focused tests. No `api.rs` route registration, intake/parser,
new changes/recurrence modules, schema or generated-type edits in polish.

### API contract

- Settings: additive `changes` with 1–6 unique `{field,values,confirmHideUnassigned?}`
  entries. One transaction, all-or-nothing validation; cannot mix batch and single/
  suggestion actions. Preserve untouched confirmations, current admin checks,
  server actor and existing last-write-wins semantics. Old requests still work.
- Review: additive `reasonCode` plus
  `timeDetails[{endpoint,status,clock,label,at}]` on unresolved timeline items.
  At most five endpoint groups, each value capped at 128 characters; no raw-body
  reads or inference. Coordinate the small presentation hunk when merging recurrence.
- Search: existing endpoints/templates/ranking only. `api.rs::timeline` forwards the
  existing search response's `executedMode` (or browse for an empty query). The UI
  retains the fixed hybrid request and reports missing execution metadata explicitly.
  Existing timeline query includes activities with no start_at independent of date bounds.

### Tests

Added/updated form batch/reset/roles/revocation; atomic rollback/duplicate/mixed/
forged batch checks; burst/paste/clear/Back URL state; single hybrid request and actual
executed-mode disclosure without extra controls/live regions; all-layout no-selection;
typed time explanations across views;
narrow disclosure; lane widths; resource colours and source links. Month journey adds
row containment and hit-testing, not just DOM visibility. Some older journey workflow
expectations predate the current Rust UI; live synthetic-stack checks are also needed.

Supplied container report at `694e55a`: **Rust green, TypeScript green,
UI 91 passed / 3 failed** (collapsed test sidebar, duplicate status role, mode selector).
`a1f4e8e` removes the extra live role/selector without weakening existing Calendar/
Messages assertions and restores the original search-state expectation. Report at
`d261c03`: **94 passed / 1 failed**, roster controls unavailable. `5677f87` adds an
independent positive innerWidth guard; `2a826ef` implements clarified search scope.
Report at `2a826ef`: **Cargo OK, TypeScript OK, UI 93 passed / 2 failed**. The remaining
mode/roster failures were traced to the shared ConnectQuery cache, not product behavior.
`31c62a5` supplies isolated QueryClients per test iteration and clears them on cleanup;
assertions are unchanged. Container rerun required. Locally: `git diff --check` only;
no builds, test execution or fresh screenshots claimed.

### Screenshots to attach

- One Settings Save: unchanged/dirty/saved/Cancel, hide-Unassigned confirmation,
  read-only user and failed-write draft retention.
- 05 NOV Month show-more visible/hit-testable, open popup with every returned event.
- Zero-delay communications input + URL; executed mode for communications and radio
  rehearsal; unchanged result sets, loading/error and missing mode metadata.
- Clear all / unknown ship in Combined and Side; missing-date review in all three views
  with exact source returns.
- 400x900 Day/Week/Month, Ships closed/open, clock/bell separation and footer below review.
- Dense Week/Side at 1280/1440px, title/tooltips, header-body alignment, keyboard overflow,
  zoom, ship tint/contrast in light and dark.
- User acknowledgement modal and Draft saved · unsent, on an isolated test database.

### TODOs

Container Ark build/test/check/journey and Rust tests; live browser geometry/contrast.
No source-wide completeness, calibrated semantic threshold, audit history, optimistic
revision conflict handling, production assignment, or session lifecycle implementation
is claimed. Keep mail, custody and private-state volumes separate and intact.

### Questions for Parker

- **Search quality:** the supplied live review found `communications` omits two
  communications-check titles, while `radio rehearsal` returns the same five events /
  four messages despite no title word match. Does semantic top-k make effectively
  every query look like a match on this small corpus? Source inspection confirms the
  Calendar restricts to the first ranked passage-backed message page; generated event
  titles need not have a narrative passage. The finding is not proof of useful relevance.
  **Proposed server-side fix, not implemented:** lexical hits first; semantic-only hits
  listed separately as **Related** only above a calibrated similarity threshold. Keep
  the single box. Which score/model calibration, title indexing, candidate depth and
  paging contract should govern it? Do not threshold an RRF rank as if it were cosine
  similarity or silently change ranking in a UI polish patch.
- Accept scrolling dense lanes instead of shrinking labels? Keep Calendar review and
  additive time details? Retain changed-fields last-write-wins?
- Rename the misleading Send Acknowledgement label to Prepare acknowledgement later?
