# Watch Desk demo port — PR notes

Branch: `feat/watchdesk-port`, base `60ac735`. Local commits only; Neal owns publication.
All added cases are constructed fictional data. No excluded traffic restored/read.
Builds and runtime tests are delegated to Claude's containers, not claimed locally.

## P1 — Calendar Needs review (placement needs Parker's call)

Parker deliberately removed the Calendar review list in `971ac11`. `DESIGN.md`
(notification/review guidance around lines 132/200) points unresolved schedules to
inbox Action items, but `60ac735` has no unresolved-schedule producer. **This slice
restores review on Calendar, or we route it to the inbox instead — Parker's call.**
It is not a claim that his simplified calendar was an accidental regression.

- **Files:** `apps/watch-desk/ui/src/components/calendar-review{,.test}.tsx`,
  `ui/src/pages/calendar.tsx`, `ui/src/index.css` (UI paths under `apps/watch-desk/`).
- **Contract:** consumes existing `meta.reviewItems` and `windowLimited`; no Rust/API
  change. Each row links its exact `messageKey` (including revision), identifies the
  supplied fact ID, and preserves Calendar `returnTo`. No source ID means no link.
- **Behavior:** unresolved facts stay outside the time grid. Review is a compact,
  scrollable disclosure; counts explicitly cover returned records, not the whole
  watch or all ships. Missing review data differs from an empty returned set.
  Ship/search filtering always discloses potentially hidden review and offers an
  explicit Show-all/clear-search action; it never persists preferences. Refresh,
  pending search and errors hide stale rows. Day/Week/cards/zoom remain unchanged.
  Theme-aware gutter and readable warning text avoid white-on-white dark gutters.
- **Tests added:** exact revision/return links, bounded/hidden notices, missing
  source, empty versus unavailable, Calendar integration with point events and
  failed-refresh stale-data suppression. JSON fetch is mocked and awaited; the
  console-error guard stays enabled. Not run locally (container handoff).
- **Validation:** `git diff --check` only; container UI/checks and light/dark/mobile
  screenshots remain outstanding.
- **TODO / Parker:** hidden review *totals* need a server-wide bounded projection;
  this slice says unavailable, never fabricates zero or subtracts filtered pages.
  Review rows are source uncertainty, not operational approval.

## Demo-grade deferrals (apply to subsequent slices)

Deferred: audit tables, optimistic-revision conflicts, durable amendment/cancellation
producers and retention. **Permissions are not deferred (Neal's P2 steer): every new
application write calls `access::require_admin`, resolving the current server session,
and records that identity's username as actor.** No caller-supplied actor/role.
Keep authenticated same-origin reads, input bounds and source citations. Production
command assignment is Parker's Q6 decision; no message-text inference is permitted.
Context is not acknowledgement authority or authorization.

## P2 — Synthetic roster, explicit applicability and ship sidebar

- **Files:** `backend/config/watchdesk-demo.json`, six newly constructed bodies in
  `backend/config/watchdesk-fixtures/`, intake config (now default-off; see the
  P4 review follow-up and `compose.watchdesk-demo.yml`); intake
  `src/{demo,config,service,lib}.rs`, `tests/custody.rs`; server
  `src/{commands,access,error,main,lib}.rs`, `tests/commands_contract.rs`; UI
  `components/{command-roster,ships-sidebar,day-timeline,calendar-review,source-data}`,
  Calendar, related tests and CSS.
- **API:** `POST /api/v1/commands/list {}` returns `commands` with id/name/shortLabel/
  group/colorIndex/isOwnShip, config source/version/provenance and assignmentEnabled.
  Authenticated, strict unknown-field rejection, <=32 commands. No roster write API.
- **Assignment:** `demo_fixture_assignments` defaults false. The P4 review follow-up
  moved the Compose opt-in to a separate Watch Desk override. Exact decoded-body
  SHA-256 allowlist (LF and CRLF variants)
  supplies `ParseContext.command_ids`. Changed/unlisted bodies remain Unassigned;
  sender/participants/mentions/unit never supply IDs. Shared fixture assigns Tern
  and Halyard; the unassigned fixture names Meridian/Halyard but assigns neither.
  Existing audit outbox records the fixture/config/version and message-level scope.
  No operational per-fact assignment is asserted. **Parker to decide production
  assignment (Q6).** Fixture policy is versioned source configuration, not a UI edit.
- **UI:** own ship pinned, grouped checkboxes/Only/select-all/clear, search above six
  ships, mobile native disclosure; Parker's JSON `ships` and server filters remain.
  None stays `[]`, malformed/stale selection never becomes all. Show/URL hydration
  writes no storage (P2 has URL-only preferences). Canonical chips use all explicit
  IDs; empty IDs show REVIEW even with a unit/sender. Amber only denotes review.
  Roster reads never fall back to examples on failure. Presentation clones protobuf
  messages instead of mutating cache entries.
- **Tests added:** allowlist hashes/line endings, changed-body denial, opt-in intake
  through canonical projection + assignment audit, multi-command/empty chips,
  outgoing URL/filter requests, roster failures, real server-session read/write-role
  checks and server actor. Updated old Calendar mount tests to mock/settle JSON reads.
- **Validation:** static diff/JSON/hash checks only; no builds/tests run here.
- **Demo setup:** fixtures are *not* automatically sent or loaded. Neal must verify
  the isolated demo mailbox/destination before using the existing mail helper with
  `backend/config/watchdesk-fixtures/*.txt`. Use 5 Nov 2026 in Calendar. Receipt/change
  time will be actual custody time, not the authored issue time. Do not clear volumes
  or reprocess existing records as a shortcut; config changes are not a backfill.
- **TODOs:** persistent user preferences, complete hidden-review aggregation, and
  production roster/assignment policy. P1 placement remains Parker's decision.

### User-lifecycle seam — interface only; owned by the other contributor

- Keep `App::headers_identity(headers) -> Result<Identity>` as the server integration
  point. Future resolver: `resolve_session(cookie) -> {subjectId, username, roles,
  enabled, sessionVersion}`; reject disabled/revoked/expired sessions on every request.
  Adapt it to the current Identity until multi-role identity is agreed.
- New mutators call `access::require_admin(app, headers) -> Identity`; writes store
  the returned `username` (future stable subject ID plus username snapshot). Never
  accept actor, role, or enabledness from JSON/browser state. Current demo sessions
  still resolve role-based `dev-user`/`dev-admin`; they are not a user directory.
- Other contributor owns `create_user`, `disable_user`, `assign_roles`, session
  invalidation/role refresh, replacement of demo identities and migration of existing
  sessions. Disable/role removal must take effect before the next write, including
  already-open Settings pages. Do not reuse display ship selection as access control.
- Coordinate `api.rs` identity resolution, `web.rs`, `private.rs` sessions and identity
  response/cache invalidation before merging. No user-management endpoints/tables or
  lifecycle behavior are implemented by this port.

## P2 follow-up — preserve Parker's title controls

Container report for `1a3e36d`: Rust green, TypeScript green; UI 73 passed / 2 failed
because REVIEW entered existing event controls' `textContent`. Badges now render as
noninteractive siblings of the link/button; each control still contains only its
original title/icon. Intrinsic collision-label measurements include sibling badges.
Restored the original title-only assertion changed in P2, and added the sibling-badge
assertion to the new command test. Parker's reported failing assertions remain intact.
Files: `day-timeline.tsx`, `calendar-layout.ts`, `command-roster.test.tsx`,
`pages/calendar.test.tsx`, `index.css`. Static diff check only; container rerun pending.

## P3 — Side-by-side Day

- **Files:** UI `components/{calendar-resources,calendar-resources.test,day-timeline}`,
  `pages/calendar.tsx`, `index.css`.
- **Contract:** UI-only `shipLayout=combined|side`; existing `ships` JSON and Week's
  `layout=expanded` are unchanged. Side is applied only to Day. Source links retain
  the whole Calendar URL. No server or permission changes (view state only).
- **Behavior:** RBC resources render selected named ships plus Unassigned; empty
  selection stays empty. Shared facts are copied for presentation only into each
  explicitly assigned visible ship, never inferred from unit. Combined/Month/Week
  remain deduplicated. Parker's lane algorithm runs per resource; 220px minimum
  columns scroll inside the calendar. Header labels replace repeated ship chips in
  Side; title controls retain the P2 follow-up contract, icons and exact-time hover.
- **Tests:** shared point duplication/deduplication, unchanged source objects,
  empty/invalid selection, Unassigned despite a reported unit, independent collision
  lanes, exact source/return URLs and Week ignoring `shipLayout=side`.
- **Validation:** static diff review only; Claude owns typecheck, UI suite and
  desktop/mobile/zoom/collision screenshots. No builds/tests run locally.
- **TODO / Parker:** confirm minimum column width and review placement; no resource
  layout is added to Week. No source timestamps/durations or counts are fabricated.

## P3 visual/fixture follow-up — fit columns and open at useful times

- **Observed:** the live `74a9413` screenshots show seven timed facts in the Week
  index, but only Sunday/Monday horizontally and midnight at the top of Day.
  Baseline `60ac735` already used `7 * collision_lanes * 128px` as Week minimum
  width and `scrollToTime=from`; P2's sidebar further reduced available space.
  P3 likewise multiplied every resource's width by the largest collision count.
- **Fix:** Week minimum is now seven 112px days plus gutter, independent of lanes;
  five demo resources fit at 168px minimum each and grow with available width.
  At >=1280px, legacy Expanded minimum width no longer forces horizontal scroll.
  Week keeps seven days, collision lanes, icons, hover/details and wheel zoom;
  its time grid scrolls vertically, with compact ellipsized titles, not narrower type.
  Opening scroll chooses the earlier of the first visible source time and now-1h
  (within the shown dates); pinned historical days use source time. It waits for
  source readiness and runs once per view/query, never fighting manual wheel/scroll.
- **Fixture oracle:** six messages, four resolved intervals (Meridian 0800–0900Z,
  Tern 1400–1600Z, Halyard 1500–1700Z, shared Tern+Halyard 1430–1530Z), three points
  and two deliberately unresolved times, all resolved times on 5 Nov 2026.
  Added fictional GENTEXT paragraphs to Meridian/Halyard/Tern/shared: handover,
  replenishment rehearsal, logistics coordination and simulated EMCON/radio silence.
  These are narrative search inputs, not additional extracted tasking.
- **Config/data:** `watchdesk-demo-v2` updates exact LF/CRLF hashes for those four
  files. Changed bodies are NEW message IDs, not amendments. Existing stored records
  are untouched; re-sending into the same database retains old and new versions as
  distinct messages. Use a separately isolated demo mailbox/database for a clean
  six-record screenshot; never reset shared volumes or silently erase old evidence.
- **Tests:** viewport width/scroll policy and one-shot/manual-scroll behavior; intake
  parser oracle for 4 intervals / 3 points / 2 unresolved, exact shared timing and
  the publisher's real narrative audit/span eligibility in four source bodies.
  Existing hash tests cover both line endings. No parser/publisher behavior changed.
- **Validation:** static JSON/hash and diff checks only. Claude must rerun UI/Rust,
  inspect all seven days/five columns at 1280/1440px, and confirm four narrative
  passage inputs become searchable after publication/local embedding. Useful queries:
  “watch handover”, “replenishment approach”, “radio silence”. Model readiness alone
  does not prove the new passages have been published/embedded.

## P4 — Admin-controlled watch context and cited Settings

- **Files:** server `src/{watch_context,context_metadata,commands,private,main,lib}.rs`,
  `tests/commands_contract.rs`; UI `pages/settings{,.test}.tsx`,
  `components/{watch-context,watch-context-header,app-layout,navigation-menu,
  command-roster,ships-sidebar}` and CSS. Normal UI route generation must run in
  the container build; no generated files were edited. No protobuf/ENT changes.
- **API:** `POST /api/v1/watch-context/get {includeSuggestions?:boolean}` returns
  context, per-field confirmations, last server actor/time, viewer canEdit and
  optional grouped suggestions with bounded scope/availability. Update accepts
  either `{field,values,confirmHideUnassigned?}` or `{suggestionId,dismiss?}`.
  Only operationName is suggestible; own ship, display ship name, group/command,
  visible defaults and UTC turnovers remain explicit/manual. Unknown JSON fields
  (including actor/role) fail. All updates call `access::require_admin`; a user
  receives 403, no session receives 401. Actor comes from the current server session,
  not the browser. Every write retains that username and recording time; field
  confirmation keeps the verified citations and Unassigned-hide confirmation.
- **Storage:** additive singleton table in existing protected private-state SQLite,
  one transaction per update, bounded document. Last-write-wins; no audit history or
  optimistic conflict machinery. Display ship name is an override only, not a roster
  alias or acknowledgement identity. Confirmed values never change automatically.
- **Suggestions:** read-only custody connection, latest 200 published records / 400
  metadata fields. SQL selects only EXER/OPER fields from supported parse_completed
  profiles; it verifies UTF-8 byte spans against that revision's preserved source
  and computes source line bounds in SQLite. No bodies cross this read boundary,
  no detail fan-out. Same value is grouped, newest citation first, <=20 groups and
  <=20 citations/group; availability/limits remain explicit. Use/Dismiss applies to
  the group; Use is recomputed server-side and cannot carry manual values. Groups
  matching current are labelled/excluded from conflicts. No typed group metadata is
  invented. Header reads skip suggestion work entirely.
- **UI:** Settings via Parker's nav popover; header links to provenance with Calendar
  state retained. Read-only users see disabled editors. Failed writes retain drafts.
  Identity-keyed queries/remounted editors do not carry an admin draft to another
  login. Removing Unassigned defaults requires a checked confirmation in the actual
  request; sidebar applies defaults explicitly, without changing absent-URL=all.
- **Tests:** server-session admin/user/no-session mutation checks and durable actor;
  manual visibility guards, forged payload rejection, grouped Use/Dismiss; Unicode
  source line bounds, corrupt-span exclusion, metadata-only response and caps; UI
  request assertions, confirmed header/citations, missing source arrays, read-only
  role and revoked-write draft preservation. No application builds/tests run here.
- **Validation:** diff check and standalone in-memory SQLite metadata scalar check
  passed (exact UTF-8 bytes/Unicode prefix, correct line 2, no body in result).
  Rust/TypeScript/UI/route generation and screenshots are Claude's container gate.
- **TODOs / Parker:** audit history, optimistic conflicts, retention and production
  roster/own-unit/group contracts remain deferred. User lifecycle stays with the
  other contributor at the documented identity seam; permissions are implemented.
  Edits to shared confirmed fields can replace matching local editor drafts on an
  explicit refresh/save; full multi-user draft conflict UX is not implemented.

## P4 build follow-up — checked SQLite integer reads

Container report for `aea938d`: UI 83/83 and TypeScript passed; Rust failed with five
E0277 errors because this rusqlite version does not implement `FromSql` for `u64`.
`context_metadata.rs` now reads SQLite integers as `i64`; citation byte/line bounds
use checked `u64::try_from`, returning a sanitized unavailable error for negatives.
COUNT remains signed internally. Added zero/max/negative conversion coverage.
Static diff check only here; the Rust container rerun remains outstanding.

## P4 review follow-up — explicit demo scope and bounded suggestions

- **H1 / L8:** `commands::catalog` gates the fictional roster on the effective
  `intake.demo_fixture_assignments` flag. Off means an empty roster and empty own ship,
  including when earlier demo context is stored. Out-of-scope IDs/confirmations are
  suppressed in responses, not erased from SQLite by reads or unrelated updates.
  Fresh off-mode defaults retain Unassigned and the built-in UTC turnover schedule.
  Header: “Own ship not set”; non-demo defaults are not labelled demo defaults.
  Manual writes validate against the active roster and still use `require_admin`.
- Root/default `demo-compose-intake.json` now sets the flag **false**. The separate
  `compose.watchdesk-demo.yml` opts in via server-only `PARSE_COMMAND_WATCHDESK_DEMO=true`;
  this overrides the loaded intake flag for both ingestion and presentation. Invalid
  environment values fail configuration; no duplicate copy of the intake config.
  For the fictional demo use `docker compose -f docker-compose.yml -f
  compose.watchdesk-demo.yml ...`. Neither option reloads fixtures, rewrites existing
  canonical assignments, resets volumes, nor establishes production authority.
- **M2 / Parker's call:** Week Fit retains all seven days at desktop width. Expanded
  again uses `52 + 7 * collisionColumns * 128` and Parker's existing expanded CSS.
  Fit/resource overrides are scoped to `.calendar-with-ships`; zoom still takes
  precedence. Day resources keep their bounded width. Live screenshots must confirm
  both modes and zoom; this is not a claim that the entire Week redesign is approved.
- **M3:** only the read-only metadata job has a seven-second deadline. Timeouts/errors
  degrade to `suggestionState: unavailable`; ordinary context reads/manual updates
  still run. At most two metadata jobs retain worker permits until they really exit.
  Context transactions are awaited outside that deadline, with admin authority
  resolved again before writing. There is no timed-out background context writer.
  This does not solve ordinary network-disconnect ambiguity, audit history or CAS.
- **L5:** regenerated `route-registry.generated.ts` using the actual bundled
  `ark/pipeline/generate-routes.ts` invoked by `build-ui.ts`. Bun is absent locally:
  Node's TS stripping plus a narrow `Glob('*.tsx')` adapter ran that unchanged
  generator; all four pages, including Settings, are present. No app build, installs,
  framework edits or manually authored registry entries.
- **L6:** removed the contradictory reported-unit tooltip line. Canonical test data
  uses explicit IDs and a sole-ID unit only together; the separate pure-helper
  adversarial/legacy test still proves unit is never used as assignment authority.
- **L10:** port styles live in `ui/src/watchdesk-port.css`, imported once. Compared
  with `60ac735`, Parker's `index.css` now differs only by that import.
- **Tests added/extended:** demo on/off session/API and header cases, stored-context
  suppression without destruction, opt-in configuration parsing, unavailable/slow
  suggestions with readable/editable context, Fit versus Expanded width, canonical
  applicability tooltip. Container tests/builds and new screenshots remain pending.
- **Deferred:** L7 skipped as requested (demo links pin `?date=`). L9 is note-only;
  its finding text has not yet been supplied, so no mechanism or fix is inferred.
  P5 work remains uncommitted and outside this review-fix commit.

## Next slice order

Finish P5, then **P5b recurrence** under Addenda R/R2, then P6. No new crates or
lockfile change. R2 permits additive baseline crypto recurrence with explicit source
periods; preserve existing activity fields/IDs, retain unresolved behavior without
an anchor, and never use issue/receipt time. Keep the synthetic radio-check path and
add a baseline crypto fixture, schema/types/mapping updates and expansion tests.
Parker must run the external OPTASK regression against his unavailable samples.

## Polish 1 — One Settings save

- One form, dirty status, disabled unchanged Save settings and Cancel changes.
  Only changed fields are sent in one request; failures/refresh retain drafts.
  Use/Dismiss remain distinct actions and wait for manual drafts to be saved/cancelled.
- Minimal server seam: `watch_context.rs` accepts `changes` (1–6 unique fields),
  validates and commits atomically in the existing transaction; legacy single-field
  requests still work. Existing server-session admin checks, actor/citations and
  last-write-wins semantics remain. There is no `expectedRevision` in this base.
  No routes, intake/parser, changes or recurrence modules touched.
- Tests added/updated: form batching/reset/read-only/revocation, batch rollback and
  forged/duplicate/mixed inputs, admin/user/no-session batch authorization.
- Validation: static diff review only; Claude must run container build/tests.
- Screenshots to attach: Settings pristine/dirty/saved, hide-Unassigned confirmation,
  read-only user, light/dark and 400px. Parker: accept changed-fields last-write-wins?

## Polish 2 — Month overflow affordance

- Month events now use the same 24px height as RBC's dummy capacity measurement;
  ship chips and titles stay on one ellipsized row. A 600px month floor keeps date
  headings and show-more reachable even when controls/review consume the viewport.
- Files: `watchdesk-port.css`, monthly journey. No API changes.
- Added containment + real hit-test assertion before the existing popup click.
  Existing journey has older workflow expectations; Claude must exercise the current
  canonical demo at 05 NOV in both themes and narrow/short viewports as well.
- Static diff check only; no build/browser run. Attach Month + open popup screenshots.

## Polish 3 — Fast Calendar input

- `git show 60ac735:apps/watch-desk/ui/src/pages/calendar.tsx` confirms the same
  URL-controlled input and stale `new URLSearchParams(canonical)` update in base.
  This is a source-level finding; base was not run here.
- `calendar-params.ts` keeps input state synchronous while Router transitions the
  URL. All Calendar edits compose against the latest params; Back/Forward restores
  routed state. Added burst/paste/clear/same-turn view/back regression coverage.
- No API change. Static diff check only. Container UI tests and a zero-delay typing
  browser check remain required; attach the final query/URL screenshot.

## Polish 4 — Lexical Calendar and explicit related search (Parker's call)

- Source check: Calendar searched narrative passages first, then restricted timeline
  to the first message-search page. A title need not have a narrative passage; hybrid
  top-k does not establish a literal match. No relevance score threshold is calibrated.
- Least invasive policy implemented entirely in UI: fetch the bounded selected-ship
  timeline independently, include every returned title/header containing all query
  words, union with returned keyword-passage message matches. Preserve source limits;
  disclose first keyword page truncation, search pending/error and actual executed mode.
  Keyword failure retains local matches with an explicit partial-search warning.
- Related messages is an explicit link to hybrid Message search, not silent plotting.
  Message search defaults keyword and offers Related (hybrid); executed mode comes
  from response metadata, not the requested mode. Hybrid results are labelled ranked,
  possibly without literal matches. No uncalibrated threshold or completeness claim.
- Files: Calendar, Messages, `calendar-search{,.test}.tsx`/`.ts`, message search state
  and tests, port CSS. API contract unchanged; no server edits or new search templates.
- Tests added: both communications-title hits survive empty passage hits, no automatic
  radio-rehearsal semantic fallback, keyword requests/limits/mode and explicit related URL.
- Static diff check only; container tests and live searches pending. Attach communications
  Calendar, radio rehearsal empty/local versus Related hybrid, and unavailable search.
- Parker: accept keyword-first default? Server-side exhaustive title/narrative union,
  relevance calibration and cross-page aggregation remain separate search work.

## Polish 5 — Selection is not an empty watch

- Combined/Side/Week/Month explicitly say No ships selected for empty or wholly
  out-of-roster selections. Suppress timeline/search requests when none is selected;
  review says not queried, never an all-clear. Filtered empty review has distinct copy.
- Files: Calendar, CalendarReview and roster/review tests. No API changes.
- Static diff check only. Container tests pending; attach Clear all and stale-ship URL
  screenshots in Combined and Side. Mixed known/unknown keys remain preserved, not broadened.

## Polish 6 — Explain missing time, not a generic warning

- Minimal server seam in `presentation::timeline`: additive `reasonCode` and
  `timeDetails[{endpoint,status,clock,label,at}]` for unresolved activities. Five
  canonical endpoint groups, each string capped at 128 characters; no source-body
  reads, schema/generated-type changes or parser edits. Coordinate this small
  presentation hunk when merging recurrence work; no new recurrence modules touched.
- Copy uses typed endpoint statuses and raw labels where present. The demo's
  1200Z/1800Z source tokens survive canonically as normalized 12:00Z/18:00Z clocks,
  NOT raw labels, so UI says “normalized clocks”. Missing end, missing zone/year,
  open end and non-positive intervals remain distinct. Old responses get a fallback.
- View-independent explanation is limited to undated items. Verified the existing
  timeline template includes activities lacking start_at regardless of view bounds;
  dated intervals/points still use normal bounds. No source timestamp is invented.
- Files: `presentation.rs`, private-state tests, UI source-data/review/review-time tests.
  Projection tests cover Day/Week/Month; renderer tests cover clocks, raw labels and
  missing/invalid endpoints. Static diff check only; container execution pending.
- Attach both demo review rows and unchanged source return links in Day/Week/Month.
  Parker: accept additive presentation fields and retain Calendar review placement?

## Polish 7 — Narrow layout

- Ships starts collapsed at <=900px, shows selection count and retains user toggles.
  Narrow Calendar uses page flow, not a fixed viewport that compresses the grid;
  time surface has a ~420px floor. Header clock occupies its own row below controls
  at <=640px. Header menu/initial contrast is also explicit in both themes.
- Files: ShipsSidebar/test, port CSS. No API change. Static diff check only.
- Container gate: 400x900 Day/Week/Month with Ships closed/open, header/bell separation,
  footer below review and no document horizontal overflow; repeat dark and desktop.
  Attach those screenshots; no browser-size claim made locally.

## P6 queue from live review (remaining items)

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
