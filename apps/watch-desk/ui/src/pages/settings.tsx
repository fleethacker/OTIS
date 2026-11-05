import { useId, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { RouteMeta } from "../route-registry";
import { calendarReturn, messageHref } from "../components/calendar-links";
import { useCommands, type Command } from "../components/command-roster";
import { useWatchContext, useUpdateContext, type ContextCitation, type ContextField, type ContextUpdate } from "../components/watch-context";

export const route: RouteMeta = { path: "/settings", label: "Settings", order: 2 };
const fields: [ContextField, string][] = [
  ["ownShipId", "Own ship"], ["shipName", "Display ship name"],
  ["operationName", "Operation / exercise"], ["groupCommand", "Group / command"],
  ["defaultShips", "Default visible ships"], ["turnoverUtc", "UTC watch turnovers"],
];
function Citation({ source, returnTo }: { source: ContextCitation; returnTo: string }) {
  if (!source.messageKey) return <span>Source unavailable</span>;
  return <Link to={messageHref(source.messageKey, returnTo)}>
    {source.setId} · {source.messageKey} · lines {source.lineStart}–{source.lineEnd}
  </Link>;
}
function Editor({ field, label, values, commands, disabled, save }: {
  field: ContextField; label: string; values: string[]; commands: Command[];
  disabled: boolean; save: (request: ContextUpdate) => Promise<unknown>;
}) {
  const id = useId();
  const [draft, setDraft] = useState(values);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const hides = field === "defaultShips" && !draft.includes("unassigned:");
  const choices = [...commands.map((c) => [`unit:${c.id}`, c.name]), ["unassigned:", "Unassigned / needs applicability review"]];
  return <form className="context-editor" onSubmit={async (e) => {
    e.preventDefault(); setPending(true); setError("");
    try {
      await save({ field, values: draft, ...(hides ? { confirmHideUnassigned: confirm } : {}) });
      setConfirm(false);
    } catch (error) { setError(error instanceof Error ? error.message : "Save result unavailable; refresh before retrying"); }
    finally { setPending(false); }
  }}>
    <fieldset disabled={disabled || pending}>
      <legend>{label}</legend>
      {field === "ownShipId" ? <select className="select select-sm" aria-label={label} value={draft[0]} onChange={(e) => setDraft([e.target.value])}>
        <option value="">Not set</option>
        {commands.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select> : field === "defaultShips" ? <div className="context-ship-options">{choices.map(([key, name]) => <label key={key}>
        <input type="checkbox" checked={draft.includes(key)} onChange={(e) => { setConfirm(false); setDraft(e.target.checked ? [...draft, key] : draft.filter((v) => v !== key)); }} />{name}
      </label>)}</div> : <input className="input input-sm" aria-label={label} value={draft.join(", ")} maxLength={field === "turnoverUtc" ? 192 : 128}
        onChange={(e) => setDraft(field === "turnoverUtc" ? e.target.value.split(",").map((v) => v.trim()) : [e.target.value])} />}
      {field === "shipName" && <p>Display override only; does not change roster IDs, tasking or acknowledgement authority.</p>}
      {field === "turnoverUtc" && <p>Comma-separated UTC values, e.g. 0000Z, 0400Z. Calendar remains UTC.</p>}
      {field === "defaultShips" && <p>Applied explicitly with “Use app defaults” in the sidebar; shared URLs retain their own selection.</p>}
      {hides && <label htmlFor={id} className="context-hide-confirm"><input id={id} type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />I confirm hiding Unassigned from app-wide defaults.</label>}
      <button className="btn btn-sm" disabled={disabled || pending || (hides && !confirm)}>{pending ? "Saving…" : `Save ${label}`}</button>
    </fieldset>
    {error && <p role="alert">{error}</p>}
  </form>;
}
export default function Settings() {
  const context = useWatchContext(true);
  const roster = useCommands();
  const update = useUpdateContext();
  const [params] = useSearchParams();
  const returnTo = calendarReturn(params.get("returnTo"));
  const data = context.data;
  const [actionError, setActionError] = useState("");
  async function suggest(suggestionId: string, dismiss = false) {
    setActionError("");
    try { await update.mutateAsync({ suggestionId, ...(dismiss ? { dismiss: true } : {}) }); }
    catch (error) { setActionError(error instanceof Error ? error.message : "Update unavailable"); }
  }
  return <section className="watch-settings" aria-labelledby="settings-heading">
    <Link className="back-link" to={returnTo}>Return to Calendar</Link>
    <h1 id="settings-heading">Settings / watch context</h1>
    <button className="btn btn-sm" disabled={context.isFetching || update.isPending} onClick={() => { void context.refetch(); }}>Refresh context and suggestions</button>
    <p>App-wide display defaults, not tasking, access control or acknowledgement authority. Concurrent edits are last-write-wins; no durable change history in this demo.</p>
    {context.isPending && <p role="status">Loading watch context…</p>}
    {context.isError && <p role="alert">Context unavailable. <button className="btn btn-sm" onClick={() => { void context.refetch(); }}>Retry context</button></p>}
    {data && !context.isError && <div key={context.identityKey}>
      {!context.canEdit && <p>Read only. A platform administrator must change shared context.</p>}
      <p>{data.updatedBy ? `Last update: ${data.updatedBy} · ${data.updatedAt}` : `Unconfirmed demo defaults · ${data.defaultsSource}`}</p>
      {roster.isError && <p role="alert">Roster unavailable; ship selection cannot be edited.</p>}
      {fields.map(([field, label]) => {
        const value = data.context[field];
        const values = typeof value === "string" ? [value] : value;
        const confirmation = data.confirmations[field];
        return <div key={`${field}:${JSON.stringify(values)}`}>
          <Editor field={field} label={label} values={values} commands={roster.isError ? [] : roster.data?.commands ?? []}
            disabled={!context.canEdit || update.isPending || ((field === "ownShipId" || field === "defaultShips") && (roster.isError || !roster.data))} save={(request) => update.mutateAsync(request)} />
          {confirmation && <p className="context-confirmation">Confirmed by {confirmation.actor} · {confirmation.recordedAt}
            {(confirmation.sources ?? []).map((source) => <span key={`${source.auditId}:${source.startByte}`}> · <Citation source={source} returnTo={returnTo} /></span>)}
            {!confirmation.sources?.length && " · Manual entry"}
          </p>}
        </div>;
      })}
      <section className="context-suggestions" aria-label="Source suggestions">
        <h2>Source suggestions — human confirmation required</h2>
        <p>Verified EXER/OPER metadata only. Own ship, Group / command and default ships are manual; sender/addressees are not applicability.</p>
        <p>{data.suggestionScope}{data.suggestionsLimited ? " · Limited results" : ""}</p>
        {data.suggestionState === "unavailable" && <p role="status">Source suggestions unavailable; manual context remains editable.</p>}
        {data.suggestionState === "available" && data.suggestions.length === 0 && <p>No suggestions in the returned metadata.</p>}
        {data.suggestions.filter((s) => s.values[0] !== data.context.operationName).length > 1 && <p className="context-conflict">Conflicting source values; choose explicitly. No automatic overwrite.</p>}
        {data.suggestions.map((suggestion) => <article key={suggestion.id} className="context-suggestion">
          <h3>{suggestion.values.join(", ")}{suggestion.values[0] === data.context.operationName && <small> · matches current</small>}</h3>
          {suggestion.sources?.[0] ? <Citation source={suggestion.sources[0]} returnTo={returnTo} /> : <p>Source unavailable</p>}
          {(suggestion.sources?.length ?? 0) > 1 && <details><summary>+{suggestion.sources!.length - 1} more sources</summary><ul>{suggestion.sources!.slice(1).map((s) => <li key={`${s.auditId}:${s.startByte}`}><Citation source={s} returnTo={returnTo} /></li>)}</ul></details>}
          <div className="context-actions">
            <button className="btn btn-sm" disabled={!context.canEdit || update.isPending || !suggestion.sources?.length} onClick={() => { void suggest(suggestion.id); }}>Use {suggestion.values.join(", ")}</button>
            <button className="btn btn-sm" disabled={!context.canEdit || update.isPending} onClick={() => { void suggest(suggestion.id, true); }}>Dismiss {suggestion.values.join(", ")}</button>
          </div>
        </article>)}
        {actionError && <p role="alert">{actionError}</p>}
      </section>
    </div>}
  </section>;
}
