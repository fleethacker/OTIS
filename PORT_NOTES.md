# Watch Desk demo port — PR notes

Branch: `feat/watchdesk-port`, base `60ac735`. Local commits only; Neal owns publication.
All added cases are constructed fictional data. No excluded traffic restored/read.
Builds and runtime tests are delegated to Claude's containers, not claimed locally.

## P1 — Calendar Needs review

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

Explicitly deferred by Neal: admin-only Settings permissions, audit tables,
optimistic-revision conflicts, durable amendment/cancellation producers and
retention. Keep authenticated same-origin handlers, input bounds and source
citations. Production command assignment is Parker's Q6 decision; no message-text
inference is permitted. Context is not acknowledgement authority or authorization.
