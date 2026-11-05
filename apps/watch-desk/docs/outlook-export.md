# Calendar export to Outlook

Open **Sync to Outlook** in the Calendar heading. The dialog starts with the
sidebar's current ship selection and the viewed UTC date through seven days
later, inclusive. Changes in the dialog do not change the sidebar or calendar
search. Event-type checkboxes use the event titles already returned by the source.

**Download .ics** creates `otis-optasks-<yyyymmdd>.ics` in the browser; the date in
the filename is the selected start date. Import this file into Outlook. This is a
snapshot, not a subscription. The secondary **Sync to Outlook** button posts the
same filtered calendar to the application server and reports new/updated counts.
If direct sync is not configured, it explains that and suggests Download .ics.
Failures never claim success.

## Demo mailbox calendar

Direct sync is a **demo CalDAV stand-in, not an Exchange/Outlook connection**.
No email or invitation traffic is sent. Start the separately provided calendar
services with `docker compose -f demo/docker-compose.yml up -d --wait calendar
calendar-viewer`, then run the application with `docker-compose.yml` plus
`compose.watchdesk-demo.yml`. Open the loopback viewer address published by the
`calendar-viewer` service to watch events arrive. Viewer packaging, port and
credential-file wiring belong to the demo services configuration.

The server requires `PARSE_COMMAND_WATCHDESK_DEMO=true`,
`PARSE_COMMAND_DEMO_CALENDAR_URL=http://calendar:5232/sailor/otis/`,
`PARSE_COMMAND_DEMO_CALENDAR_USER=sailor` and
`PARSE_COMMAND_DEMO_CALENDAR_PASSWORD` injected from the demo credential file.
Never put the password in UI code, shell commands or logs. The server already
joins `parse-command-demo_mail`; no calendar host port is needed. Without the
explicit flag or URL, `POST /api/v1/calendar/outlook-sync` returns 404.

The authenticated, same-origin endpoint accepts only `{ "ics": "…" }`, up to
2 MiB and 500 unique VEVENTs. It creates a missing collection, then PUTs each
VEVENT using hex SHA-256 of its UID as the resource name. Repeat syncs update
existing resources; deselecting events later does not delete them. A failed or
timed-out sync may have written a subset: retry the same selection safely.
Calendar failures return 502 `calendar_unavailable` without upstream credentials
or bodies. Each DAV request has a five-second timeout, batches contain at most
eight writes, and the full operation has a 30-second deadline. The app proxy
allows the larger request and a 40-second response window for this route only.
Preserve the calendar volume separately from mail, custody and UI data.

## Scope and source fidelity

- The dialog reads the existing timeline endpoint for its selected UTC window,
  independently of the calendar search. Both date endpoints are inclusive; the
  existing API limits requests to 42 days. Ship/type filters apply locally.
- Preview, download and sync use the same filtered events. Partial source results
  are labeled. Loading, failed, invalid-range and empty selections cannot write.
  More than 500 events can still download but cannot direct-sync.
- Points must start inside the range. Intervals must overlap it and retain their
  original start/end rather than being clipped. A point with no end gets 30 minutes.
  Unresolved or invalid times are excluded and counted after ship/type filtering;
  no current date or browser-local timezone is substituted for a missing time.
- Canonical recurrences export as the API's bounded individual occurrences, with
  occurrence-specific fact IDs. They do **not** carry RRULE, and the activity
  prototypes are not exported a second time. The timeline response does not carry
  the series start/bounds needed to safely construct a master recurrence.
- UID is derived from message key and fact ID. Multi-ship facts export once, with
  all applicable ship names and the source event title in CATEGORIES.
- DESCRIPTION contains the message title, same-origin message link and
  `UNCLASSIFIED // FICTIONAL DEMO DATA`. Sent DTG is included only when already
  present in the loaded response's message headers; it is never inferred from
  event or receipt time. No additional source-detail reads are needed.
- Files use UTC times, RFC 5545 TEXT escaping, UTF-8-aware 75-octet folding and CRLF.

## Verification

Synthetic coverage lives in `ui/src/components/calendar-ics.test.ts` and
`ui/src/components/calendar-outlook.test.tsx`. Panel tests use a fresh QueryClient
per mount and cover downloads, filters, pending/success/404/error sync states,
request shape and agreement between downloaded and posted ICS. The generator
also tests RRULE pass-through for an explicitly supplied series master; the
current timeline adapter intentionally uses expanded occurrences instead.

Backend tests cover splitting, bounds, UID hashes, collection creation, repeat
PUTs, errors, gating, Origin and authentication. The ignored test in
`backend/crates/parse-command-server/tests/calendar_sync.rs` requires isolated
`PARSE_COMMAND_TEST_OPENSEARCH_URL`, a disposable calendar at
`PARSE_COMMAND_TEST_CALENDAR_URL` and the calendar user/password variables above.
It writes a uniquely named synthetic event and leaves it in that disposable
calendar; do not point it at a shared mailbox.

Build/typecheck/test execution and container/live verification for this change
are delegated to the host watcher. A real Exchange adapter remains outside this
demo integration.
