import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { messageHref } from "./calendar-links";
import { CommandChips, type Command } from "./command-roster";
import { readShips, selectedShipFilters } from "./ship-calendars";
import { useChanges, type WatchChange } from "./watch-changes";
import { formatSinceUTC, parseSinceUTC, sinceState, useWatchClock } from "./watch-boundary";

function BoundaryEditor({ boundary, now, apply, automatic }: { boundary?: number; now: number; apply: (value: number) => void; automatic: () => void }) {
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
    <button className="btn btn-sm" type="button" onClick={automatic}>Use automatic watch</button>
    {error && <p role="alert">{error}</p>}
  </form>;
}
function ChangeRow({ row, commands, returnTo }: { row: WatchChange; commands: Command[]; returnTo: string }) {
  return <li>
    <CommandChips ids={row.commandIds} commands={commands} /> {" "}
    {row.messageKey ? <Link to={`${messageHref(row.messageKey, returnTo)}&tab=lifecycle`}>{row.title}</Link> : <strong>{row.title} · source unavailable</strong>}
    <p>{row.recordedAt ? <><time dateTime={row.recordedAt} title={row.recordedAt}>{formatSinceUTC(Date.parse(row.recordedAt))}</time> · first custody recording</> : "Custody time unknown — not counted in this watch"}</p>
    <small>{row.receiptId ? `Custody receipt ${row.receiptId}` : "Custody receipt unavailable"} · {row.messageKey ?? row.id}</small>
  </li>;
}
export function WatchTurnoverPanel({ turnovers, commands = [], returnTo, now: fixedNow }: {
  turnovers?: string[]; commands?: Command[]; returnTo: string; now?: number;
}) {
  const clock = useWatchClock(fixedNow === undefined);
  const now = fixedNow ?? clock;
  const [params, setParams] = useSearchParams();
  const state = sinceState(params.get("since"), now, turnovers);
  const valid = state.boundary !== undefined && state.boundary <= now && now + 1 - state.boundary <= 42 * 86400000;
  const query = useChanges({
    since: state.boundary === undefined ? "" : new Date(state.boundary).toISOString(),
    // Include the currently observed millisecond with an exclusive upper endpoint.
    until: new Date(now + 1).toISOString(), filters: selectedShipFilters(readShips(params.get("ships"))),
  }, valid);
  const unavailable = !valid || query.isError;
  const pages = unavailable || query.isRefetching ? [] : query.data?.pages ?? [];
  const first = pages[0];
  const items = [...new Map(pages.flatMap((p) => p.items).map((row) => [row.id, row])).values()];
  const returned = pages.reduce((n, p) => n + p.returnedNewCount, 0);
  const hidden = pages.reduce((n, p) => n + p.hiddenCount, 0);
  const unknown = first?.unknownTime ?? [];
  const unknownHidden = first?.unknownHiddenCount ?? 0;
  function changeSince(value: string) {
    const next = new URLSearchParams(params); next.set("since", value); setParams(next);
  }
  return <section className="watch-turnover" aria-label="Since last watch">
    <details open={state.open} onToggle={(e) => {
      if (e.currentTarget.open !== state.open) changeSince(e.currentTarget.open ? state.choice : `closed:${state.choice}`);
    }}>
      <summary>
        Since last watch{state.boundary !== undefined ? ` · ${formatSinceUTC(state.boundary)}` : ""} · {unavailable ? "unavailable" : query.isPending || query.isRefetching ? "loading…" : `${returned} new custody records returned`}
        {hidden > 0 ? ` · ${hidden} hidden` : ""}{unknown.length + unknownHidden > 0 ? ` · ${unknown.length + unknownHidden} time unknown` : ""}{first && query.hasNextPage ? " · more pages" : ""}
      </summary>
      <div className="turnover-content">
        <BoundaryEditor key={`${state.choice}:${state.boundary}`} boundary={state.boundary} now={now} apply={(at) => changeSince(new Date(at).toISOString())} automatic={() => changeSince("auto")} />
        <p>Custody recording time, not message issue time or scheduled start. Ship filters apply; calendar search/date do not filter this history.</p>
        <p>Amended: not available · Cancelled: not available · Review transitions: not available. No authoritative producer is connected for these kinds.</p>
        {!valid && <p>{state.invalid ? "Invalid since value in URL." : "A valid watch boundary is unavailable. Configure UTC turnovers in Settings or pin a UTC time above."}</p>}
        {query.isError && <p role="alert">Turnover evidence unavailable. {query.error.message} <button className="btn btn-sm" onClick={() => { void query.refetch(); }}>Retry turnover</button></p>}
        {valid && query.isPending && <p aria-live="polite">Loading custody evidence…</p>}
        {first && <>
          <p>{first.scope} Through {formatSinceUTC(now)}.</p>
          {(hidden > 0 || unknownHidden > 0) && <p className="turnover-hidden">{hidden} dated and {unknownHidden} undated records on hidden ships · <button className="btn btn-sm" onClick={() => {
            const next = new URLSearchParams(params); next.delete("ships"); next.delete("q"); setParams(next);
          }}>Show all ships</button></p>}
          {items.length ? <ul>{items.map((row) => <ChangeRow key={row.id} row={row} commands={commands} returnTo={returnTo} />)}</ul> : <p>No selected dated custody records in the returned pages.</p>}
          {query.hasNextPage && <button className="btn btn-sm" disabled={query.isFetchingNextPage} onClick={() => { void query.fetchNextPage(); }}>Load more custody records</button>}
          {(unknown.length > 0 || first.unknownLimited) && <section aria-label="Custody time unknown">
            <h3>Time unknown — outside dated counts</h3>
            {first.unknownLimited && <p>Unknown-time list limited to 50 records.</p>}
            <ul>{unknown.map((row) => <ChangeRow key={row.id} row={row} commands={commands} returnTo={returnTo} />)}</ul>
          </section>}
        </>}
      </div>
    </details>
  </section>;
}
