# Standards

## Project-specific standards

- Calendar and Message records are separate navigable experiences; the calendar must not contain the message-record list or reader.
- The calendar is the landing experience, with a full-width Gantt timeline as its dominant element and search above it.
- Calendar search matches event titles, message text, message IDs, units, and locations, updating both the timeline and upcoming-event list.
- Provide Day and Month views, previous and next period navigation, Today, a date picker, and explicit Zulu/UTC labeling.
- Day view represents the full 24-hour day on a horizontal time axis, supports 30-minute and one-hour grid intervals, and allows focusing on a smaller visible time window.
- Month view uses one column per calendar day, represents multi-day events, respects differing month lengths, and opens the chosen date in Day view when its heading is selected.
- Each event has its own row; bar position and length accurately reflect actual start and end timestamps, including overlaps, midnight crossings, and month boundaries.
- Every event bar has a visible title and exact start/end labels, including dates for multi-day events; labels that do not fit remain readable beside or below the bar rather than depending on hover.
- Bars are clipped to the visible time window with clear continuation indicators; today is highlighted and revisions are distinguished through both text and color.
- Below the calendar, show the next five upcoming matching events ordered by start time, each with title, date/time, location, and a source-record link.
- Events with incomplete or unresolved start/end times remain outside the timeline and have a visible review notice linking to their records.
- Selecting a calendar event or upcoming-event entry opens its source message; direct links select the correct message, and returning to the calendar restores date, view, grid interval, visible hours, and search query.
- Message records support a searchable list beside the selected reader on desktop and a stacked arrangement on narrow displays.
- Record entries show message ID, subject or event title, received timestamp, available extracted schedule, and an appropriate status such as Parsed, Updated, or Needs review.
- The reader shows subject, message ID, sender, received timestamp, extracted event times and locations, and visible revision information when available; one message can contain multiple events.
- Provide Raw message and Parsed fields views; raw text is monospaced with line numbers, and available source lines supporting extracted times and locations are highlighted.
- Message actions sit to the right of raw text on desktop; acknowledgement drafts are editable, reference the selected message, can be saved, and remain explicitly unsent.
- Summarize remains visible but disabled and clearly identified as a planned future AI feature; no fabricated summary is shown.
- Messages and extracted events remain distinct records with stable links; retain available recipients, processing status, revision history, supporting source-line references, and prior schedule values.
- All timestamps are timezone-aware and all schedule calculations consistently use UTC.
- Use an existing backend contract when available; otherwise provide replaceable fictional data access with documented proposed integration expectations, without exposing search-system credentials to the browser.
- Fictional USS Meridian examples cover several short same-day events, overlaps, a multi-day event, a midnight crossing, a revised event, missing times, and multiple events from one message; all example content is labeled fictional and illustrative syntax is not represented as validated USMTF.
- Support loading, empty-search, missing-data, and API-error states without presenting missing information as confirmed schedule data.
- Provide keyboard-accessible controls, visible focus, and labels that do not rely on color alone; preserve readable timeline labels through horizontal scrolling where necessary.
- Run the application and relevant checks, inspect actual desktop and mobile rendering, and verify search, interval changes, month navigation, time positioning, boundary crossings, source selection, calendar-state restoration, incomplete-time exclusion, and draft-only saving.
- Deliver concise startup instructions, integration notes, and an honest account of working versus mocked behavior; do not deploy or publish the application.
