# Watch Desk presentation

## Guided acknowledgement preparation

The existing reader action column now pairs a guided Prepare acknowledgement surface with the
unchanged legacy free-text editor. No legacy text is parsed or replaced. All operational fields
start blank, including response and family; a single reference letter links the selected response.
Generated output is server-validated, plain text and unsent. Any edit invalidates the preview and
Copy action until regeneration. Save preparation accepts incomplete work; failed writes retain
edits. Copy success requires clipboard success; failures leave a selectable preview for manual email
paste.

Lifecycle keeps upstream history read-only and adds a separately labeled private activity section.
User-reported external acknowledgement requires deliberate confirmation; reset appends history and
cannot remove upstream evidence. Recorder, server recording time and separately supplied occurrence
time remain distinct; unknown occurrence time stays unavailable. Draft/save/generate/copy never
mean acknowledgement or command approval. Composer and tracking share the same verified disposable
private session, not the global source cache. Navigation and unload guard unsaved preparation.

The bounded 2003-reference profile supports one REF, one ACTAGCY or ICVALID, optional single-field
EXER or OPER and complete calendar-valid DDHHMMZMONYYYY only. Repeated references/authorities,
other date alternatives, DECL/classified-release composition and complete character/profile
certification are unsupported. No routing, email launch, sending or release authorization is added.
Native labeled controls, wrapping action rows and selectable monospaced output inherit both themes
and stack in the existing narrow reader. Use `ark run job test-ui` and `ark run stage checks`.

## Structured Message records

The reader inherits the bordered work surface and tab order. Optional structured source JSON
uses one shared card with registered section/field labels in `structured-message.tsx`, not a
bespoke OPTASK layout. Extend `sections`, `knownFields`, or `labels` to add a known grouping;
unregistered keys at every depth appear once under Additional fields. Arrays preserve order.
Null, absent, empty list, empty object, false and zero remain distinct. Frequency values retain
exact Hz; only complete offset-bearing instants enter the shared display-time formatter.
Fragments and status qualifiers stay literal. No period/activity creates calendar events.

Attachment references carry their filename attribution and are not fictional ship data,
operational imports, raw USMTF, validated security markings or lifecycle evidence. The fourteen
references appear only in isolated test fixtures; persisted adapters may supply the optional
payload via the existing read contract. Legacy readers, raw evidence and private drafts remain.
Nested fields stack on narrow screens; long tokens wrap rather than hiding behind hover.

## Ship calendars

The compact Ships disclosure uses native checkboxes, Select all and Clear all. Options come only
from the complete successful snapshot, not the current view or search. `unit:` plus the edge-trimmed
event unit is the current replaceable identity boundary; case and internal spelling remain distinct,
and aliases are never merged. `unassigned:` is separately namespaced for blank/missing units and
eventless review records. A future verified registry can replace this helper, not infer ownership
from message text. No production data or integration is added.

URL `ships` holds a JSON array of stable keys encoded by URLSearchParams. Absence defaults to all;
an explicit empty array means none. Invalid or stale keys never broaden selection and remain until
deliberate recovery. Source return links already retain this parameter. Selection filters events
before text discovery; record review follows selected associations without leaking deselected
unresolved events. Identity-hashed marker colors remain stable in all views, next to textual ship
names; amber Revised styling remains independent. Native controls need no new library.

## Weekly schedule

Week now defaults to compact viewport fit, measuring the calendar's actual page offset after
controls and notices wrap. Seven columns and the full chosen clock window remain intact.
URL `layout=expanded` deliberately restores a larger scrollable reading surface; narrow
screens use a controlled horizontal overflow fallback rather than shrinking type. Compact
buttons truncate within their own geometry; native modal details retain exact dates, ship,
revision/continuation evidence and source return links. Events in window provides a complete
keyboard-accessible index for very short/dense bars, not a duplicate details list below.
Day/Month retain their sole source links; Week uses one details button per event instead.

Day/Week/Month is explicit URL-owned view state. Week uses the installed React Big Calendar
time grid and Moment locale week start (currently Sunday). Civil seven-day navigation and
period bounds respect the display zone and DST; daily min/max clocks are separate from
whole-week inclusion bounds. Each column retains elapsed-minute placement, including 23/25-hour
days; exact offset-bearing event labels disambiguate repeated hours. The seven-column surface
has a wider minimum width for readable labels and keyboard-accessible horizontal scrolling.
No new dependency, backend, editable schedule or deployment is introduced.

## Display time (supersedes UTC-only presentation notes below)

The compact header toggle defaults to Zulu / UTC and retains Local in guarded browser storage;
storage denial keeps the preference in memory. Local is the browser's IANA zone, never an arbitrary
zone picker. Calendar URL dates and hours remain civil values on a mode change. Period boundaries,
Today, navigation and month drilling use the selected zone. Day slots use elapsed minutes so DST
days have 23/25 hours; both repeated hours have separate positions and numeric offsets. Local
generated labels include full dates and UTC offsets, including fractional offsets. Source/API
instants and raw source text are never changed. Upcoming ordering remains absolute. Notifications
keep their explicitly UTC operational day and existing read policy. No dependency or backend change.

## Schedule discovery

Search shares the compact calendar control row, with matching small input heights and bottom-aligned
edges. A flexible search field keeps a usable minimum and wraps with the native controls as space
shrinks. Its associated scope hint occupies a separate line inside the same control region, so it
does not displace the control baseline. URL state and display-zone behavior are unchanged.

Calendar search filters the complete SourceDataService snapshot locally across event titles, unit,
location, source message IDs and raw message text. No additional request or query language is used.
URL `q` drives both projections and global upcoming results; no asynchronous query can race it.
Upcoming means confirmed current start at or after the browser's UTC instant, capped at five.
Review notices link affected records even when no timed match exists. Refresh hides older results
until success; failure never presents the cached snapshot as current. An available-date action
opens a matching event's date and full-day hours without redefining Today. No dependency is needed
for native search and a short chronological list. The source currently returns all records without
pagination; any future paginated integration must retain complete matching/ordering semantics.

## Draft acknowledgements

The reader action column now contains an editable draft referencing the selected message.
Save draft stores exact text privately by authenticated subject and message in the application
database. Reload or reopen to restore it; an empty saved text clears the response. Editing marks
unsaved changes. Navigation asks whether to discard or cancel and preserve; reload/close uses
the browser's unsaved-change warning. Failed saves keep text for retry. Draft read failures do not
offer a blank editor that could overwrite unseen saved text. Nothing is sent, no schedule status
changes, and Summarize remains disabled. There is no sharing or collaborative conflict resolution;
concurrent saves for the same owner/message use the last completed write. Use the existing startup
instructions below; no external integration or credentials are added.

Private draft queries live in a disposable, app-owned QueryClient rather than the shared schedule
cache. An opaque mounted-session generation isolates reads and mutations, including inactive message
drafts. Auth-change messages, storage changes, focus and visibility return discard that cache and
unsaved editor state, then verify identity with a fresh RPC before reading private text. This
conservative reset applies even if the account is unchanged; the editor explains it. Failed identity
verification or draft reads expose no editor or Save action. No bundled auth framework is modified.

## In-app notifications

The bell immediately precedes Account on both routes. Its compact, scrollable disclosure uses
ordinary links and buttons, explicit unread/type text and the existing theme. It does not overlay
a reader on Calendar. Escape returns focus; outside interaction and Tab-out dismiss it.
One current UTC-date reminder is derived on app use; a foreground clock and focus/visibility
checks update it across midnight. No server worker, email, push or background delivery exists.
Action items group source issues per message, including revised events and unresolved schedules.
Read means seen, not resolved; successful refresh removes resolved issues. Stable source/content
keys allow new revision content to be unread again, without retrieval-time or ordering churn.
Read keys are localStorage-only, namespaced by signed-in username and email. No cross-device
sharing exists. Malformed or unavailable storage falls back to in-memory read state with a notice.
Refresh failures hide unconfirmed action items and explicitly report an unavailable count.

## Usage and direction

Watchstanders compare exact UTC times and inspect their source. Calendar is the dominant full-width
surface; Message records is a separate destination. React Big Calendar's standard vertical Day
and conventional Month grid replace the earlier horizontal watch-sheet layout by confirmed choice.

## Shared conventions

- Navy wordmark/header, neutral working surfaces, teal schedule bars and active destinations; amber
  plus the word Revised marks changed information. Borders separate time and records, not decorative
  cards.
- System sans typography deliberately keeps controls familiar and avoids network font requirements.
  Headings 24/18px; ordinary content 16px; metadata 14px. Tabular numerals for times. Spacing
  follows a 4px base with 8/12/16/24/32px grouping.
- Light and dark daisyUI tokens follow browser preference live. Focus uses a visible teal outline.
  Main navigation uses aria-current via NavLink. Account uses the existing identity hook and
  /logout.
- Narrow screens wrap chrome and controls; only the labeled, keyboard-focusable timeline scrolls
  horizontally. Event content includes inline UTC times; full evidence remains in source records.

## Routes and data handoff

Calendar: `/calendar` (first ordered destination; root redirects here). Message records:
`/messages?record=<stable-message-id>&returnTo=<encoded-calendar-path-and-query>`. `calendarReturn`
permits only same-origin `/calendar` paths, preventing external redirects. Query state is URL-owned
and survives source inspection/reload; future schedule features should encode date, view, interval,
hours and query here.

SourceDataService supplies the shared read-only message/event snapshot. Fictional USS Meridian
content is illustrative, not operational information or validated USMTF. Search, source navigation,
review notices, chronological upcoming events and draft-only saving are functional. No live upstream
integration, parsing, transmission or AI summary is claimed.

## Running and verification

## Daily schedule extension

Native date/select controls own URL parameters `date`, `view`, `interval` (30/60 minutes), `hours`
(`start-end`, UTC hours) and `q`. Source links carry the complete calendar URL through reader
reload. React Big Calendar renders a vertical, read-only Day grid, with selectable overlaps and
window clipping. Inline event content retains source timestamps and continuation/revision cues;
source records retain full revision evidence. Upcoming events immediately follows Calendar, then
Needs review. Available-date navigation sits in the calendar toolbar. No duplicate details list,
drag/drop or editing.

## Monthly schedule extension

The read-only calendar exposes ordinary date buttons and source links within its named scroll
region, not a keyboard grid/table. `CalendarAccessibility` scopes an adapter to RBC's layered
layout, removing table/row/cell/header roles that cannot describe overlapping event spans or empty
all-day rows. It also normalizes remeasurement and popup descendants without changing controls.

`SourceEventWrapper` uses RBC's public event-wrapper hook to retain layout while removing the
outer button role, tab stop and selection handlers. Each event's native source link remains its
only interactive target, including Day/Week timed events and Month/popup events. Exact labels,
revision cues and URL-owned return context remain unchanged.

Month uses the standard seven-column calendar grid, multi-day spans and show-more popup. Native
date-heading buttons open the exact UTC Day without clearing hours, interval or query. Month
navigation anchors to the first to avoid short-month rollover. Show-more opens additional events.
Only confirmed, finite, positive intervals intersecting the selected
period/window enter the calendar; unresolved schedules retain their separate source review links.

### Calendar dependencies and UTC integration

- `react-big-calendar@1.20.0`, MIT, published 2026-06-01T02:34:56.687Z; supports React 19.
- `moment-timezone@0.6.5`, MIT, published 2026-10-02T10:09:16.300Z. The newer 0.6.6 was less
  than seven days old at selection and is intentionally not selected.
- `@types/react-big-calendar@1.16.3`, MIT, published 2025-09-12T18:02:36.365Z; development types.

Registry timestamps, peer ranges and exact-version license files were checked before installation.
No runtime network or new backend is needed. Required calendar CSS is imported before app styles.
`calendar-localizer.ts` configures Moment's single app scheduling zone as UTC; source Dates remain
their real instants, never browser-wall-clock substitutes. The Moment localizer handles start/end,
merge, range, comparison, slot creation and navigation in UTC. Its browser-local DST/offset hooks
are explicitly overridden to zero, minutes-from-midnight uses UTC, and segmentOffset is zero:
UTC calendar-day differences need no browser-zone subtraction. Date-only checks also use UTC.
This avoids the stock 1.20.0 `.local()` DST helper and browser-offset month-span correction.
Today/current-time use the real current instant interpreted through the same localizer.

Run `ark run job journey --spec ui/tests/journey/replace-calendar-with-react-big-calendar.spec.ts`
for actual Day positions in UTC and America/New_York, including spring/fall DST, overlaps,
midnight clipping, interval/window changes, both layouts and source round trips. Daily/monthly
regressions additionally cover month lengths, year boundaries and failure/retry states.

## Message reader extension

Reader views are ordered Parsed fields, Raw message, Lifecycle, with Parsed fields reset on
record selection. Arrow keys, Home and End move tab selection and focus together. Lifecycle is
a source-owned vertical history, never a list of ship activities or private draft actions.
Dated entries precede explicitly undated evidence; missing milestones are not inferred.

Inactive message-view tabs use the theme's muted foreground at full opacity rather than
translucent text. The selected tab retains its active underline; both themes must keep
normal-size labels above 4.5:1 contrast on the reader surface.

Message records now reads the shared SourceDataService snapshot. A bordered list/reader work surface
keeps selection explicit; narrow screens stack the two. Raw text wraps without clipping, with
numbered lines and textual Time/Location evidence labels. Revised and Needs review cues use words
and amber rules. Missing fields remain Unavailable, including partial prior schedules. Actions sit
to the reader's right on wide screens and below on narrow screens. Summarize stays disabled; draft
editing belongs to the later draft story. Native controls and CSS suffice; no new dependencies.

Selection is authoritative in `record`; unknown IDs never choose a substitute. `returnTo` is
retained unchanged and validated only by calendarReturn. Search is immediate local input and is
recorded in the URL when a record is selected. The service remains read-only; this slice adds no
extraction, transmission or upstream access. Run its browser proof with
`ark run job journey --spec ui/tests/journey/inspect-message-records.spec.ts`.

From root: `ark run job build && ./bin/app` (see `docs/ark-handoff.md` for identity and isolated DB
setup). Tests: `ark run job test-ui` and
`ark run job journey --spec ui/tests/journey/app-shell.spec.ts`. Journey artifacts cover desktop and
narrow light/dark rendering. No deployment or upstream integration is included.
