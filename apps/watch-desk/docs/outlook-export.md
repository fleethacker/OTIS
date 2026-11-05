# Calendar export to Outlook

Open **Sync to Outlook** in the Calendar toolbar. The dialog starts with the
sidebar's current ship selection and the viewed UTC date through seven days
later, inclusive. Changes in the dialog do not change the sidebar or calendar
search. Event-type checkboxes use the event titles already returned by the source.

**Download .ics** creates `otis-optasks-<yyyymmdd>.ics` in the browser; the date in
the filename is the selected start date. Import this file into Outlook. This is a
snapshot, not a subscription or a live connection. The secondary **Sync to Outlook**
button is deliberately a stub: it explains that the deployment has no connection
and sends nothing.

## Scope and source fidelity

- The dialog reads the existing timeline endpoint for its selected UTC window,
  independently of the calendar search. Both date endpoints are inclusive; the
  existing API limits requests to 42 days. Ship/type filters apply locally.
- Counts and the download use exactly the same filtered events. Source limits are
  shown explicitly; a partial response is not a complete calendar. Narrow the date
  range if needed. Loading, failed, invalid-range and empty selections cannot download.
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
  event or receipt time. No additional detail reads or server changes are needed.
- Files use UTC times, RFC 5545 TEXT escaping, UTF-8-aware 75-octet folding and CRLF.

## Verification

Synthetic coverage lives in `ui/src/components/calendar-ics.test.ts` and
`ui/src/components/calendar-outlook.test.tsx`. The panel tests use a fresh
QueryClient per mount and verify the downloaded Blob, filters, error handling,
range reads, prefilled selections and the stub. The generator also tests RRULE
pass-through for an explicitly supplied series master; the current timeline
adapter intentionally uses expanded occurrences instead.

Build/typecheck/test execution is delegated to the host container watcher for
this change. Theme-token usage was reviewed in source; interactive theme checks
and a real Outlook import still require a browser and Outlook.
