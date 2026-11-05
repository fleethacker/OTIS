# Watch Desk presentation

This document describes the current React presentation on the Rust application
stack. Historical handoff documents describe earlier designs, not current behavior.
The multi-ship roster and fixtures are explicitly fictional and opt-in. Production
assignment, operational approval and transmission are not implied by display context.

## Shell and visual conventions

Calendar is the main schedule surface; Message records is a separate source reader;
Settings holds shared watch context. The navy header contains navigation, confirmed
context/provenance, a live display-zone clock, notification bell and account menu.
At <=640px the clock occupies a separate row, not the bell/account space.

System fonts and bundled icons/assets require no runtime CDN. Neutral theme surfaces,
teal controls and stable ship colours work in light/dark themes. Named ships do not
use amber: amber denotes review/unassigned applicability or revised information.
Colour is paired with ship labels or status words, never used as the only identity.
Port-specific CSS lives in `ui/src/watchdesk-port.css`; the base stylesheet imports it.
Focus remains visible on native links/buttons, disclosures and scroll regions.

## Ships sidebar and applicability

The roster is an authenticated configuration read, independent of filtered source
pages. It does not fall back to example ships on failure. Own ship is pinned first;
other commands are grouped. Each has a checkbox, swatch and Only action. Groups can
be toggled together; Select all, Clear all and explicit Use app defaults are available.
Ship search appears above six commands. The native Ships disclosure starts closed
only when both positive viewport width and a narrow media query establish <=900px;
no-layout environments default open. User toggles remain deliberate.

`ships` in the URL is a JSON array of stable `unit:<command-id>` keys and optional
`unassigned:`. Absent means all; `[]` means none. Malformed/stale selection never
broadens to all and is retained until changed. No valid selected ships produces
“No ships selected” in all calendar layouts; review is “not queried”, not all-clear.
Selection is a view preference, never a server authorization rule.

Canonical `commandIds` alone determine applicability. Sender, addressees, event
unit and text mentions are not assignment authority. Empty IDs are Unassigned /
needs applicability review. Shared facts retain all explicit IDs. Roster identity,
display-name override and acknowledgement authority are distinct concepts.

The fictional roster requires `compose.watchdesk-demo.yml`, which sets server-only
`PARSE_COMMAND_WATCHDESK_DEMO=true`. Default-off mode returns no fictional own ship.
Exact fixture body hashes provide demo message-level assignments; changing text
creates new identities, not amendments. Enabling the demo does not load, reparse,
backfill or delete anything.

## Calendar views, collision lanes and source navigation

Day/Week/Month, civil date, interval, Week `layout=expanded` and Day
`shipLayout=combined|side` are URL-owned. Source links retain the complete Calendar
return URL. Canonical resolved points and positive intervals are plotted as extracted
facts requiring review, not operationally confirmed orders. Unresolved times stay
outside the grid; no date, duration or recurrence is invented by the UI.

Day Combined shows each fact once. Side Day creates presentation copies in each
explicitly assigned selected ship column; it never mutates source objects. Header
chips and subtle event fills identify columns, including explicitly labelled
Unassigned. Week and Month ignore Side and remain deduplicated. Resource comparison
is Day-only.

Visual collision lanes account for short/point label footprints without changing
source timestamps. A lane reserves 128px; dense Side columns scroll horizontally.
Week Fit widens only busy days, leaving sparse days at the minimum. Expanded uses
equal lane-proportional columns. This intentionally trades dense all-columns-at-once
fit for legibility. Horizontal overflow is contained in the named, keyboard-focusable
calendar region and has a visible notice plus left/right controls. Titles ellipsize;
full titles, exact times and applicability remain in tooltips. Week also offers a
native details dialog and Events in window index, usable without hover. Day/Month
retain a single native source link per event; ship chips are noninteractive siblings
so title controls keep title-only text.

Opening scroll uses the earlier of the first visible source time and now minus one
hour, clamped to the current day's midnight. Pinned historical views use source time.
It waits for source readiness and runs once per view/query, not on every poll; manual
wheel/pointer/keyboard movement cancels pending opening scroll. Wheel zoom changes
only the time scale, never source instants. Header/day-column alignment and dense
geometry require browser validation, not just unit tests.

Month uses the standard seven-column grid, native date-heading buttons and show-more
popup. Real event rows and RBC's dummy capacity measurement share a 24px height;
chips/titles stay on one line. A 620px month floor preserves usable headings and
show-more; narrow screens scroll within the calendar surface. Date drilling preserves
search/selection and changes the URL to the exact civil Day. Month navigation anchors
to the first to avoid short-month rollover. The accessibility adapter removes RBC
roles that cannot accurately describe overlapping layout; it does not replace native
controls with a synthetic keyboard grid.

Desktop uses the available viewport. At <=900px the page itself may scroll and the
calendar has an approximately 420px usable floor; expanded Ships/review must not
compress it to a few pixels or overlap the footer. Only the calendar scrolls
horizontally, not the document.

## Search and source freshness

Calendar and Message records keep a single hybrid search box; there is no user mode
selector or URL mode override. Executed search mode is shown as **plain text from
response metadata**, not inferred from the requested mode. Timeline forwards the
existing message-search execution metadata; absent metadata says not reported.
Hybrid results may include related messages without literal word matches. This
polish does not change server ranking, candidate limits, templates or filtering.

Calendar input state updates synchronously while Router commits URL transitions;
subsequent changes compose against the latest parameters. Back/Forward restores URL
state. Debounced search does not expose stale results while typing; refresh/error
states do not present cached source data as a fresh confirmation. Loading keeps one
status region; mode/overflow explanations are non-live text.

Search operates on indexed narrative passages rather than an exhaustive event-title
index. A title match can be absent from the ranked message page; semantic top-k can
make unrelated-looking queries return similar result sets. This remains an open
server-side search question in `PORT_NOTES.md`, not a client-side ranking workaround.
Result-limit warnings apply to returned records, not the whole watch.

## Needs review panel

A bounded, scrollable disclosure follows Calendar. It consumes separate unresolved
`reviewItems`, not the plotted event list. Each row keeps the exact message revision,
fact ID, ship chips and source return link. Missing identity creates no invented link.
Missing review data, filtered empty, unqueried selection and empty returned records
are different states. Hidden-review counts are unavailable; Show all ships and clear
search is an explicit action, not an automatic preference rewrite.

Copy uses additive presentation `reasonCode` and
`timeDetails[{endpoint,status,clock,label,at}]`. Missing date, zone, month/year,
endpoint, conditional/open end and non-positive interval have specific explanations.
Source labels are preserved where supplied; normalized clock values are explicitly
labelled rather than presented as verbatim raw text. For the demo window:
“No date in source: 1200Z–1800Z (day not given; normalized clocks) · not plotted”.
No raw-message fan-out is needed to populate this panel.

“Undated items appear in every calendar view because they cannot be placed on a date.”
The timeline query includes activities without a start timestamp regardless of view
bounds. This does not make the returned list a complete review queue or imply that
all unresolved dated facts belong to every day. Placement of review on Calendar
remains a product decision.

## Settings and watch context

Settings is available through navigation and header/sidebar provenance links. It
shows app-wide own ship, display-name override, operation/exercise, group/command,
default visible ships and UTC turnovers, with server actor/time and citations.
These are display context, not tasking, access grants or acknowledgement authority.
Read-only users see disabled editors; the server independently enforces admin writes.

One form has **Save settings**, **Cancel changes** and explicit dirty status. Save
is disabled when unchanged/pending; only changed fields are sent in one bounded
atomic update (1–6 unique fields). Cancel resets to the latest loaded values. Failed
writes and refresh retain unsaved field overrides. Identity changes remount the form,
so an admin draft is not carried to another login. Removing Unassigned defaults
requires checked confirmation in the actual update. Use app defaults in the sidebar
is explicit; absent URL selection remains all.

Use/Dismiss suggestions are separate actions and disabled until manual edits are
saved/cancelled. Only operation/exercise is suggestible. EXER/OPER metadata groups
carry verified source spans, exact revision links and bounded availability; sender
and participants never imply own ship/group. Suggestions do not silently overwrite
confirmed values. Unavailable suggestions do not block manual edits. The current
server is last-write-wins for changed fields, with no expectedRevision, edit audit
history or full multi-user conflict UI. Unchanged source confirmations are preserved.

## Message reader and private acknowledgement preparation

Message records list bounded source headers; full raw/structured/audit detail loads
on demand for the exact selected key. Unknown IDs do not choose another record.
Parsed Message, Raw message and Lifecycle tabs retain native keyboard navigation.
Source-set cards preserve repeated sets and raw values; lifecycle is source evidence,
not a substitute calendar. Source instants and incomplete source values stay distinct.
The same-origin Calendar return helper rejects arbitrary external destinations.

The control labelled Send Acknowledgement opens a preparation modal. It generates
and saves an owner-scoped **unsent draft**, then offers Copy draft; it does not
transmit mail. Authenticated `user` is allowed by the Rust SavePreparation path,
which resolves session/same-origin/source scope and uses the server username as owner.
It is intentionally not subject to the admin-only shared Settings permission.
A clearer action label remains a follow-up question.

Private preparation uses the verified disposable session/cache, separate from source
cache. Source reference defaults are not release authority. Edits invalidate generated
output; failures retain input, and clipboard success is required before showing Copied.
The separate external-acknowledgement recorder requires deliberate confirmation of
an event outside the application and keeps private history; generation/copy do not
mean acknowledgement or command approval. No email launch, release authorization,
AI summary or new transmission integration is added.

## In-app notifications

The bell opens a compact scrollable inbox with ordinary links/buttons. Escape returns
focus; outside interaction and Tab-out dismiss. Current Rust notifications derive
from recorded custody/publication events: new traffic, ingestion/publication failure
and recovery. Read state is owner-scoped in private SQLite and version-aware.
**Unresolved schedules and current review flags are not inbox action-item producers.**
They remain separate Calendar review facts; reading a notification is not resolving
source uncertainty. No browser-local daily reminder, email/push or background delivery
is claimed by the current implementation.

## Display time and dependencies

Display time defaults to Zulu / UTC, with browser-local IANA presentation supported by
the shared formatter and guarded preference storage. Civil dates, navigation and
period bounds respect the display zone/DST; raw values/API instants never change.
Settings turnover values are always UTC and do not select the display zone. The live
header clock reads the actual current instant, not an accumulated timer count.

Calendar uses bundled `react-big-calendar@1.20.0` and `moment-timezone@0.6.5`, with
`@types/react-big-calendar@1.16.3`. The localizer adapter supplies explicit zone/DST
behavior and wrappers keep native source/detail controls as the sole event targets.
No new library, runtime asset download or generated-contract hand edit is required.

## Verification

Use the canonical app jobs: `ark run job build`, `ark run job test-go`,
`ark run job test-ui`, relevant checks and journeys with an isolated database. Use
`GOWORK=off` for the standalone Go reference module. Rust changes follow
`backend/README.md`; stack operation follows `docs/integration/combined-stack.md`
at the repository root. No service-health result proves source-adapter correctness.

Polish validation is delegated to containers. `PORT_NOTES.md` records supplied
reports, pending reruns, questions and the screenshot matrix. Required visual checks
include Month popup hit testing, dense Week/Side alignment and overflow, full title
access, 400px header/calendar/footer flow, light/dark contrast and source URL returns.
Older journey expectations may predate the Rust API; preserve assertions or reconcile
the relevant contract explicitly, never bypass the protected pipeline.
