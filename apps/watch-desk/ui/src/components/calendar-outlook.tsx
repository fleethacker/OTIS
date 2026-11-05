import { useState } from "react";
import type { Command } from "./command-roster";
import { Modal } from "./modal";
import { AppButton, Notice, TextInput } from "./ui";
import { useSource, type Dataset } from "./source-data";
import { UNASSIGNED } from "./ship-calendars";
import {
  calendarExportEnd, calendarExportRange, calendarIcsEvents, calendarIcsUid,
  filterCalendarIcsEvents, generateCalendarIcs,
} from "./calendar-ics";
import "./calendar-outlook.css";

interface OutlookProps {
  date: string;
  selectedShips?: ReadonlySet<string>;
  commands: readonly Command[];
  dataset: Dataset;
  returnTo: string;
}

/** Mount only while open: every opening starts from the current sidebar and day. */
export function CalendarOutlook(props: OutlookProps) {
  const [open, setOpen] = useState(false);
  return <>
    <AppButton size="sm" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
      Sync to Outlook
    </AppButton>
    {open && <Modal title="Sync to Outlook" onClose={() => setOpen(false)} className="outlook-modal">
      <OutlookPanel {...props} />
    </Modal>}
  </>;
}

function OutlookPanel({ date, selectedShips, commands, dataset, returnTo }: OutlookProps) {
  const [ships, setShips] = useState<Set<string> | undefined>(() => selectedShips === undefined ? undefined : new Set(selectedShips));
  const [types, setTypes] = useState<Set<string> | undefined>();
  const [first, setFirst] = useState(date);
  const [last, setLast] = useState(() => calendarExportEnd(date));
  const [stub, setStub] = useState(false);
  const [downloadError, setDownloadError] = useState("");
  const range = calendarExportRange(first, last);
  // Read the chosen window, not just the currently visible calendar day. Ships and
  // types are filtered locally so changing them never silently reuses a narrower read.
  const result = useSource("timeline", {
    dataset,
    ...(range ? { from: new Date(range.from).toISOString(), to: new Date(range.to).toISOString() } : {}),
  }, !!range);
  const events = calendarIcsEvents(result.data?.messages ?? [], result.data?.meta ?? {}, commands, dataset);
  const shipOptions = new Map(commands.map((command) => [`unit:${command.id}`, command.name]));
  shipOptions.set(UNASSIGNED, "Unassigned / needs applicability review");
  for (const event of events) for (const ship of event.ships) shipOptions.set(ship.key, ship.name);
  for (const key of ships ?? []) if (!shipOptions.has(key)) shipOptions.set(key, key.startsWith("unit:") ? key.slice(5) : key);
  const typeOptions = [...new Set(events.map((event) => event.eventType))].sort();
  const preview = range ? filterCalendarIcsEvents(events, { ...range, ships, types }) : undefined;
  const ready = !!range && !!result.data && !result.isFetching && !result.isError;
  function toggleType(type: string) {
    const next = new Set(types ?? typeOptions);
    if (next.has(type)) next.delete(type); else next.add(type);
    setTypes(next);
  }
  function download() {
    if (!ready || !preview?.events.length) return;
    setDownloadError("");
    try {
      const content = generateCalendarIcs(preview.events, { now: new Date(), origin: window.location.origin, returnTo });
      const url = URL.createObjectURL(new Blob([content], { type: "text/calendar;charset=utf-8" }));
      const link = document.createElement("a");
      try {
        link.href = url;
        link.download = `otis-optasks-${first.replace(/-/g, "")}.ics`;
        document.body.append(link);
        link.click();
      } finally {
        link.remove();
        // Allow the browser to consume the download before releasing the object URL.
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch {
      setDownloadError("Download could not be created. Please try again.");
    }
  }
  return <div className="outlook-panel">
    <p>Choose events to import into Outlook. These filters are separate from the calendar search.</p>
    <fieldset>
      <legend>Ships</legend>
      <div className="outlook-actions">
        <AppButton size="sm" onClick={() => setShips(undefined)}>Select all</AppButton>
        <AppButton size="sm" onClick={() => setShips(new Set())}>Clear</AppButton>
      </div>
      <div className="outlook-choices">
        {[...shipOptions].map(([key, name]) => <label key={key}>
          <input className="checkbox checkbox-sm" type="checkbox" checked={ships === undefined || ships.has(key)} onChange={() => {
            const next = new Set(ships ?? shipOptions.keys());
            if (next.has(key)) next.delete(key); else next.add(key);
            setShips(next);
          }} />{name}
        </label>)}
      </div>
    </fieldset>
    <fieldset>
      <legend>Event types</legend>
      <div className="outlook-choices">
        {typeOptions.map((type) => <label key={type}>
          <input className="checkbox checkbox-sm" type="checkbox" checked={types === undefined || types.has(type)} onChange={() => toggleType(type)} />{type}
        </label>)}
      </div>
      {ready && !typeOptions.length && <p>No event types in this window.</p>}
    </fieldset>
    <fieldset>
      <legend>Date range · UTC</legend>
      <div className="outlook-dates">
        <label>From (UTC)<TextInput className="input-sm" type="date" value={first} onChange={(event) => setFirst(event.target.value)} /></label>
        <label>Through (UTC)<TextInput className="input-sm" type="date" value={last} onChange={(event) => setLast(event.target.value)} /></label>
      </div>
      <p>Both dates included. Maximum 42 days.</p>
    </fieldset>
    {!range && <Notice tone="warning" role="alert">Choose valid dates in order, spanning no more than 42 days.</Notice>}
    {range && result.isFetching && <p role="status">Loading events…</p>}
    {range && result.isError && <Notice tone="error" role="alert">
      Events could not be loaded. {result.error.message}
      <AppButton size="sm" onClick={() => void result.refetch()}>Retry</AppButton>
    </Notice>}
    {ready && preview && <section aria-label="Export preview">
      {result.data?.meta.windowLimited && <Notice tone="warning">Partial source results. Counts cover returned records only. Narrow the date range.</Notice>}
      <p role="status">{preview.events.length} events from {preview.messageCount} messages will sync</p>
      <p>{preview.skippedUntimed} without a time, not included</p>
      <ul className="outlook-preview">
        {preview.events.slice(0, 5).map((event) => <li key={calendarIcsUid(event)}>
          <time dateTime={new Date(event.startMs).toISOString()}>{new Date(event.startMs).toISOString().slice(0, 16).replace("T", " ")} UTC</time>
          <span>{event.title} · {event.ships.map((ship) => ship.name).join(", ")}</span>
        </li>)}
      </ul>
      {preview.events.length > 5 && <p>And {preview.events.length - 5} more.</p>}
    </section>}
    <p>Recurring events export as individual occurrences in this range, not repeating series. Extracted events are not operational confirmation.</p>
    <div className="outlook-actions">
      <AppButton variant="primary" size="sm" disabled={!ready || !preview?.events.length} onClick={download}>Download .ics</AppButton>
      <AppButton size="sm" onClick={() => setStub(true)} aria-describedby="outlook-connection-status">Sync to Outlook</AppButton>
    </div>
    <p id="outlook-connection-status">Direct sync is not configured. No Outlook connection will be made.</p>
    {stub && <Notice role="status">Outlook connection is not configured on this deployment. Use Download .ics to import.</Notice>}
    {downloadError && <Notice tone="error" role="alert">{downloadError}</Notice>}
  </div>;
}
