import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { messageHref } from "./calendar-links";
import { CommandChips, type Command } from "./command-roster";
import { ALL_SHIPS, effectiveShips, selectedShipFilters } from "./ship-calendars";
import { useSettings } from "./settings-data";
import { useReviewChanges, type AddedEvent, type WatchChange } from "./watch-changes";
import { formatSinceUTC, parseSinceUTC } from "./watch-boundary";
import { needsWatchReview, reviewKnown, useWatchCatchup, type WatchCatchup } from "./watch-catchup";
import { addedEventInstant, showOnCalendar } from "./watch-calendar-link";
import { useDisplayTime } from "./display-time";
import { useCalendarParams } from "./calendar-params";
import { useCalendarPreference } from "./calendar-preferences";

function BoundaryEditor({ boundary, now, apply, automatic, sessionAvailable, session }: {
  boundary?: number; now: number; apply: (value: number) => void; automatic: () => void; sessionAvailable: boolean; session: () => void;
}) {
  const [draft, setDraft] = useState(boundary === undefined ? "" : formatSinceUTC(boundary));
  const [error, setError] = useState("");
  return <form className="turnover-boundary" onSubmit={(e) => {
    e.preventDefault();
    const at = parseSinceUTC(draft);
    if (at === undefined) { setError("Enter a valid UTC date/time, e.g. 05 NOV 2026 1600Z."); return; }
    if (at > now || now + 1 - at > 42 * 86400000) { setError("Since must be within the last 42 days and not in the future."); return; }
    setError(""); apply(at);
  }}>
    <label>Since (UTC)<input className="input input-sm" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="05 NOV 2026 1600Z" /></label>
    <button className="btn btn-sm" type="submit">Apply UTC</button>
    <button className="btn btn-sm" type="button" onClick={automatic}>{sessionAvailable ? "Use latest turnover" : "Use automatic watch"}</button>
    {sessionAvailable && <button className="btn btn-sm" type="button" onClick={session}>Use session start</button>}
    {error && <p role="alert">{error}</p>}
  </form>;
}
function AddedEventLine({ event, commands }: { event: AddedEvent; commands: Command[] }) {
  const at = addedEventInstant(event);
  const clock = (value: string) => formatSinceUTC(Date.parse(value)).split(" ").slice(-1)[0];
  const recurrence = typeof event.recurrence === "object" ? event.recurrence : undefined;
  const recurring = event.recurring || event.recurrence;
  return <p className="turnover-addition">
    Adds {at ? <time dateTime={at} title={at}>{clock(at)}{event.end && Number.isFinite(Date.parse(event.end)) ? `–${clock(event.end)}` : ""} </time> : "(time not set) "}
    {event.title}{recurring ? ` · ${recurrence?.rule?.includes("FREQ=DAILY") ? "daily" : "recurring"}` : ""}
    {event.commandIds && <> · <CommandChips ids={event.commandIds} commands={commands} /></>}
  </p>;
}
function ChangeRow({ row, commands, returnTo, pending, review }: {
  row: WatchChange; commands: Command[]; returnTo: string; pending: boolean; review: (key: string) => void;
}) {
  const { zone } = useDisplayTime();
  const tracked = reviewKnown(row);
  const reviewed = tracked && row.reviewedAt !== null;
  const calendar = showOnCalendar(row, returnTo, zone);
  return <li className={reviewed ? "turnover-row turnover-reviewed" : "turnover-row"}>
    <div className="turnover-row-heading">
      {row.messageKey ? <Link className="turnover-source" to={`${messageHref(row.messageKey, returnTo)}&tab=lifecycle`}>{row.title}</Link> : <strong>{row.title} · source unavailable</strong>}
      {tracked && <label className="turnover-reviewed-control" title={reviewed ? `Reviewed ${formatSinceUTC(Date.parse(row.reviewedAt!))}` : undefined}>
        <input type="checkbox" aria-label={`Reviewed: ${row.title}`} checked={reviewed} disabled={pending || reviewed}
          onChange={() => { if (row.messageKey) review(row.messageKey); }} />Reviewed
      </label>}
      {calendar && <Link className="btn btn-sm turnover-calendar-link" to={calendar} aria-label={`Show on calendar: ${row.title}`}>Show on calendar</Link>}
    </div>
    {!reviewed && <>
      {row.addedEvents?.slice(0, 20).map((event, index) => <AddedEventLine key={event.key ?? `${event.factId ?? "event"}:${index}`} event={event} commands={commands} />)}
      {row.addedEvents?.length === 0 && <p>No scheduled events in this message.</p>}
      {row.eventsLimited && <p>Event list is limited; open the message for all tasking.</p>}
      <p>{row.sender ? `${row.sender} · ` : ""}{row.issuedAt ? <>Sent <time dateTime={row.issuedAt} title={row.issuedAt}>{formatSinceUTC(Date.parse(row.issuedAt))}</time></> : "No issue time in source — not counted in this watch"} · <CommandChips ids={row.commandIds} commands={commands} /></p>
      {!row.commandIds.length && <p>Ship assignment is not set.</p>}
      <small>{row.recordedAt ? `Received ${formatSinceUTC(Date.parse(row.recordedAt))}` : "Received time unavailable"}</small>
    </>}
  </li>;
}
interface PanelProps { turnovers?: string[]; commands?: Command[]; returnTo: string; now?: number }
export function WatchTurnoverPanel(props: PanelProps & { catchup?: WatchCatchup }) {
  return props.catchup ? <TurnoverContent {...props} catchup={props.catchup} /> : <StandalonePanel {...props} />;
}
function StandalonePanel(props: PanelProps) {
  const [params] = useCalendarParams();
  const { shared } = useSettings();
  const catchup = useWatchCatchup({ rawSince: params.get("since"), turnovers: props.turnovers, now: props.now,
    filters: selectedShipFilters(effectiveShips(params.get("ships"), shared?.settings)) });
  return <TurnoverContent {...props} catchup={catchup} />;
}
function TurnoverContent({ commands = [], returnTo, catchup: model }: PanelProps & { catchup: WatchCatchup }) {
  const [params, updateParams] = useCalendarParams();
  const [rememberedOpen, setRememberedOpen] = useCalendarPreference("turnoverOpen");
  const mark = useReviewChanges();
  const { query, first, items, unknown, unavailable, valid, boundary, now } = model;
  const rawSince = params.get("since");
  const open = rawSince === null ? rememberedOpen || model.open : model.open;
  useEffect(() => {
    // Shared links control disclosure; an absent URL choice leaves the saved value intact.
    if (rawSince !== null && rememberedOpen !== !rawSince.startsWith("closed:")) {
      setRememberedOpen(!rawSince.startsWith("closed:"));
    }
  }, [rawSince, rememberedOpen, setRememberedOpen]);
  const unknownHidden = first?.unknownHiddenCount ?? 0;
  const newTasking = items.filter((row) => !needsWatchReview(row));
  const needsReview = items.filter(needsWatchReview);
  const tracked = model.tracked.length > 0 || (model.sessionAvailable && first && model.all.length === 0);
  const newCount = model.unreviewed.filter((row) => !needsWatchReview(row)).length;
  const needsCount = model.unreviewed.filter(needsWatchReview).length;
  const completeReviewData = model.tracked.length === model.all.length;
  const sharedWatermark = model.pages.every((page) => page.watermark === first?.watermark);
  function changeSince(value: string) {
    updateParams((next) => next.set("since", value));
  }
  const row = (item: WatchChange) => <ChangeRow key={item.messageKey ?? item.id} row={item} commands={commands} returnTo={returnTo}
    pending={mark.isPending || query.isFetching} review={(key) => mark.mutate({ messageKeys: [key] })} />;
  return <section id="since-last-watch" className="watch-turnover" aria-label="Since last watch" tabIndex={-1}>
    <details open={open} onToggle={(e) => {
      if (e.currentTarget.open !== open) {
        setRememberedOpen(e.currentTarget.open);
        changeSince(e.currentTarget.open ? model.choice : `closed:${model.choice}`);
      }
    }}>
      <summary>Since last watch · {unavailable ? "unavailable" : query.isPending || query.isRefetching ? "loading…" : tracked
        ? `${newCount} new · ${needsCount} need review · ${model.reviewed} of ${model.tracked.length} reviewed`
        : `${model.returned} ${model.returned === 1 ? "message" : "messages"} sent`}
        {model.hidden > 0 ? ` · ${model.hidden} hidden` : ""}{unknown.length + unknownHidden > 0 ? ` · ${unknown.length + unknownHidden} without sent time` : ""}{first && query.hasNextPage ? " · more pages" : ""}
      </summary>
      <div className="turnover-content">
        <div className="turnover-head">
          {boundary !== undefined && <p className="turnover-since" title={formatSinceUTC(boundary)}>{model.basis === "last_seen" ? `Since you were last here · ${formatSinceUTC(boundary)}` : model.basis === "default_24h" ? "Last 24 hours" : model.basis === "turnover" ? `Since ${formatSinceUTC(boundary).split(" ").slice(-1)[0]} turnover` : `Since ${formatSinceUTC(boundary)}`}</p>}
          <details className="turnover-change" open={!valid ? true : undefined}>
            <summary>Change…</summary>
            <BoundaryEditor key={`${model.choice}:${boundary}`} boundary={boundary} now={now} apply={(at) => changeSince(new Date(at).toISOString())}
              automatic={() => changeSince("auto")} sessionAvailable={model.sessionAvailable} session={() => changeSince("session")} />
          </details>
          {first && <div className="turnover-actions">
            <button className="btn btn-sm" disabled={query.isFetching || mark.isPending} onClick={model.refresh}>Refresh messages</button>
            {tracked && <button className="btn btn-primary btn-sm" disabled={mark.isPending || query.isFetching || !model.unreviewed.length || !completeReviewData || !sharedWatermark || model.tracked.length > 200 || query.hasNextPage}
              onClick={() => mark.mutate({ watermark: first.watermark, since: first.since, until: first.until, filters: model.filters })}>Mark all reviewed</button>}
          </div>}
        </div>
        {!valid && <p>{model.invalid ? "Invalid since value in URL." : "A valid watch boundary is unavailable. Configure UTC turnovers in Settings or pin a UTC time under Change…"}</p>}
        {query.isError && <p role="alert">Turnover evidence unavailable. {query.error.message} <button className="btn btn-sm" onClick={() => { void query.refetch(); }}>Retry turnover</button></p>}
        {mark.isError && <p role="alert">Could not mark reviewed. {mark.error.message} Try again.</p>}
        {valid && query.isPending && <p aria-live="polite">Loading messages…</p>}
        {first && <>
          <p className="turnover-note" title={`${first.scope} Through ${formatSinceUTC(model.until - 1)}. Review count covers the messages shown, including undated messages.`}>Sorted by sent time (DTG), newest first · received time shown beneath · ship filters apply</p>
          <p className="turnover-note">Changes and cancellations are not tracked yet.</p>
          {tracked && (query.hasNextPage || !completeReviewData || !sharedWatermark || model.tracked.length > 200) && <p className="turnover-note">{query.hasNextPage ? "Load remaining pages before marking all reviewed." : ""}{!completeReviewData ? " Review tracking is unavailable for some messages." : ""}{!sharedWatermark || model.tracked.length > 200 ? " Review messages individually in this window." : ""}</p>}
          {(model.hidden > 0 || unknownHidden > 0) && <p className="turnover-hidden">{model.hidden} dated and {unknownHidden} undated records on hidden ships · <button className="btn btn-sm" onClick={() => {
            updateParams((next) => { next.set("ships", ALL_SHIPS); next.delete("q"); });
          }}>Show all ships</button></p>}
          <div className="turnover-groups">
          <section aria-label="New tasking"><h3>New tasking</h3>
            {newTasking.length ? <ul>{newTasking.map(row)}</ul> : <p>No new tasking for the selected ships.</p>}
          </section>
          <section aria-label="Catch-up needs review"><h3>Needs review</h3>
            {needsReview.length > 0 && <ul>{needsReview.map(row)}</ul>}
            {(unknown.length > 0 || first.unknownLimited) && <section aria-label="No sent time in source">
              <h4>No sent time in source — outside watch counts</h4>
              {first.unknownLimited && <p>List limited to 50 messages.</p>}
              <ul>{unknown.map(row)}</ul>
            </section>}
            {!needsReview.length && !unknown.length && !first.unknownLimited && <p>No undated or unassigned messages in the returned records.</p>}
          </section>
          </div>
          {query.hasNextPage && <button className="btn btn-sm" disabled={query.isFetchingNextPage || mark.isPending} onClick={() => { void query.fetchNextPage(); }}>Load more messages</button>}
        </>}
      </div>
    </details>
  </section>;
}
