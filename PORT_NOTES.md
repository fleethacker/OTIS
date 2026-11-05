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
  `backend/config/watchdesk-fixtures/`, opt-in `demo-compose-intake.json`; intake
  `src/{demo,config,service,lib}.rs`, `tests/custody.rs`; server
  `src/{commands,access,error,main,lib}.rs`, `tests/commands_contract.rs`; UI
  `components/{command-roster,ships-sidebar,day-timeline,calendar-review,source-data}`,
  Calendar, related tests and CSS.
- **API:** `POST /api/v1/commands/list {}` returns `commands` with id/name/shortLabel/
  group/colorIndex/isOwnShip, config source/version/provenance and assignmentEnabled.
  Authenticated, strict unknown-field rejection, <=32 commands. No roster write API.
- **Assignment:** `demo_fixture_assignments` defaults false; explicitly enabled in
  the Compose demo config. Exact decoded-body SHA-256 allowlist (LF and CRLF variants)
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
