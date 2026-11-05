import { useId, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { RouteMeta } from "../route-registry";
import { calendarReturn, messageHref } from "../components/calendar-links";
import { useCommands, type Command } from "../components/command-roster";
import { useWatchContext, useUpdateContext, type ContextCitation, type ContextField, type ContextResponse, type ContextUpdate } from "../components/watch-context";

export const route: RouteMeta = { path: "/settings", label: "Settings", order: 2 };
const fields: [ContextField, string][] = [
  ["ownShipId", "Own ship"], ["shipName", "Display ship name"],
  ["operationName", "Operation / exercise"], ["groupCommand", "Group / command"],
  ["defaultShips", "Default visible ships"], ["turnoverUtc", "UTC watch turnovers"],
];
function Citation({ source, returnTo }: { source: ContextCitation; returnTo: string }) {
  if (!source.messageKey) return <span>Source unavailable</span>;
  return <Link to={messageHref(source.messageKey, returnTo)} title={`${source.setId} · ${source.messageKey}`}>
    {source.setId} message · lines {source.lineStart}–{source.lineEnd}
  </Link>;
}
function ContextForm({ data, commands, canEdit, rosterUnavailable, pending, returnTo, save }: {
  data: ContextResponse; commands: Command[]; canEdit: boolean; rosterUnavailable: boolean;
  pending: boolean; returnTo: string; save: (request: ContextUpdate) => Promise<unknown>;
}) {
  const id = useId();
  // Overrides survive failed saves and background reads. Unedited fields follow the server.
  const [draft, setDraft] = useState<Partial<Record<ContextField, string[]>>>({});
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  function current(field: ContextField) {
    const value = data.context[field];
    return field === "turnoverUtc" ? [data.context.turnoverUtc.join(", ")] : typeof value === "string" ? [value] : value;
  }
  const changed = fields.filter(([field]) => draft[field] && JSON.stringify(draft[field]) !== JSON.stringify(current(field)));
  const dirty = changed.length > 0;
  const hides = changed.some(([field]) => field === "defaultShips") && !draft.defaultShips!.includes("unassigned:");
  const busy = pending || saving;
  const choices = [...commands.map((c) => [`unit:${c.id}`, c.name]), ["unassigned:", "Unassigned / needs applicability review"]];
  const set = (field: ContextField, values: string[]) => { setDraft((previous) => ({ ...previous, [field]: values })); if (field === "defaultShips") setConfirm(false); };
  function reset() { setDraft({}); setConfirm(false); setError(""); }
  async function suggest(suggestionId: string, dismiss = false) {
    setError(""); setSaving(true);
    try { await save({ suggestionId, ...(dismiss ? { dismiss: true } : {}) }); }
    catch (error) { setError(error instanceof Error ? error.message : "Update unavailable"); }
    finally { setSaving(false); }
  }
  return <>
    <form aria-label="Watch settings" onSubmit={async (e) => {
      e.preventDefault();
      if (!canEdit || busy || !dirty || (hides && !confirm)) return;
      setSaving(true); setError("");
      try {
        await save({ changes: changed.map(([field]) => ({
          field,
          values: field === "turnoverUtc" ? draft[field]![0].split(",").map((v) => v.trim()) : draft[field]!,
          ...(field === "defaultShips" && hides ? { confirmHideUnassigned: confirm } : {}),
        })) });
        reset();
      } catch (error) { setError(error instanceof Error ? error.message : "Save result unavailable; refresh before retrying"); }
      finally { setSaving(false); }
    }}>
      {fields.map(([field, label]) => {
        const values = draft[field] ?? current(field);
        const confirmation = data.confirmations[field];
        return <div className="context-editor" key={field}>
          <fieldset disabled={!canEdit || busy || ((field === "ownShipId" || field === "defaultShips") && rosterUnavailable)}>
            <legend>{label}</legend>
            {field === "ownShipId" ? <select className="select select-sm" aria-label={label} value={values[0]} onChange={(e) => set(field, [e.target.value])}>
              <option value="">Not set</option>
              {commands.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select> : field === "defaultShips" ? <div className="context-ship-options">{choices.map(([key, name]) => <label key={key}>
              <input type="checkbox" checked={values.includes(key)} onChange={(e) => set(field, e.target.checked ? [...values, key] : values.filter((v) => v !== key))} />{name}
            </label>)}</div> : <input className="input input-sm" aria-label={label} value={values[0]} placeholder="Not set" maxLength={field === "turnoverUtc" ? 192 : 128} onChange={(e) => set(field, [e.target.value])} />}
            {field === "defaultShips" && values.length === 0 && <p className="context-empty">Not set</p>}
            {field === "shipName" && <p title="Display override only; roster IDs and acknowledgement authority are unchanged.">Name shown in the header.</p>}
            {field === "turnoverUtc" && <p>Enter Zulu times separated by commas, e.g. 0000Z, 0400Z.</p>}
            {field === "defaultShips" && <p title="Shared Calendar links keep their own ship selection.">Select “Use app defaults” in Ships to apply this list.</p>}
            {field === "defaultShips" && hides && <label htmlFor={id} className="context-hide-confirm"><input id={id} type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />I confirm hiding Unassigned from the default ship list.</label>}
          </fieldset>
          {confirmation && <p className="context-confirmation">Confirmed by {confirmation.actor} · {confirmation.recordedAt}
            {(confirmation.sources ?? []).map((source) => <span key={`${source.auditId}:${source.startByte}`}> · <Citation source={source} returnTo={returnTo} /></span>)}
            {!confirmation.sources?.length && " · Manual entry"}
          </p>}
        </div>;
      })}
      <div className="context-actions">
        <button className="btn btn-primary btn-sm" disabled={!canEdit || busy || !dirty || (hides && !confirm) || (rosterUnavailable && changed.some(([f]) => f === "ownShipId" || f === "defaultShips"))}>{saving ? "Saving…" : "Save settings"}</button>
        <button type="button" className="btn btn-sm" disabled={!dirty || busy} onClick={reset}>Cancel changes</button>
        <p role="status">{dirty ? "Unsaved changes" : "No unsaved changes"}</p>
      </div>
    </form>
    {error && <p role="alert">{error}</p>}
    <section className="context-suggestions" aria-label="Source suggestions">
      <h2>Suggestions from messages</h2>
      <p>Operation and exercise names found in messages. An administrator can choose Use to apply one.</p>
      <p title={data.suggestionScope}>Suggestions cover recent messages only.{data.suggestionsLimited ? " More suggestions may be available." : ""}</p>
      {dirty && <p>Save or cancel your changes before using or dismissing a suggestion.</p>}
      {data.suggestionState === "unavailable" && <p role="status">Suggestions are unavailable. Saved settings are still shown.</p>}
      {data.suggestionState === "available" && data.suggestions.length === 0 && <p>No suggestions found in recent messages.</p>}
      {data.suggestions.filter((s) => s.values[0] !== data.context.operationName).length > 1 && <p className="context-conflict">Different names were found. Choose the one for this watch.</p>}
      {data.suggestions.map((suggestion) => <article key={suggestion.id} className="context-suggestion">
        <h3>{suggestion.values.join(", ")}{suggestion.values[0] === data.context.operationName && <small> · matches current</small>}</h3>
        {suggestion.sources?.[0] ? <Citation source={suggestion.sources[0]} returnTo={returnTo} /> : <p>Source unavailable</p>}
        {(suggestion.sources?.length ?? 0) > 1 && <details><summary>+{suggestion.sources!.length - 1} more sources</summary><ul>{suggestion.sources!.slice(1).map((s) => <li key={`${s.auditId}:${s.startByte}`}><Citation source={s} returnTo={returnTo} /></li>)}</ul></details>}
        <div className="context-actions">
          <button className="btn btn-sm" disabled={!canEdit || busy || dirty || !suggestion.sources?.length} onClick={() => { void suggest(suggestion.id); }}>Use {suggestion.values.join(", ")}</button>
          <button className="btn btn-sm" disabled={!canEdit || busy || dirty} onClick={() => { void suggest(suggestion.id, true); }}>Dismiss {suggestion.values.join(", ")}</button>
        </div>
      </article>)}
    </section>
  </>;
}
export default function Settings() {
  const context = useWatchContext(true);
  const roster = useCommands();
  const update = useUpdateContext();
  const [params] = useSearchParams();
  const returnTo = calendarReturn(params.get("returnTo"));
  const data = context.data;
  return <section className="watch-settings" aria-labelledby="settings-heading">
    <Link className="back-link" to={returnTo}>Return to Calendar</Link>
    <h1 id="settings-heading">Watch settings</h1>
    <button type="button" className="btn btn-sm settings-refresh" title="Reload settings and message suggestions. Unsaved changes are kept." disabled={context.isFetching || update.isPending} onClick={() => { void context.refetch(); }}>Refresh settings</button>
    <p title="Display settings only, not tasking, access control or acknowledgement authority. Changed fields use last-write-wins; no durable edit history. Refresh preserves unsaved edits; Cancel resets them to the latest loaded settings.">Shared ship and watch settings.</p>
    {context.isPending && <p role="status">Loading settings…</p>}
    {context.isError && <p role="alert">Settings could not be loaded. <button className="btn btn-sm" onClick={() => { void context.refetch(); }}>Retry settings</button></p>}
    {data && <div key={context.identityKey}>
      {!context.canEdit && <p className="settings-view-only">View only. A platform administrator can change these settings.</p>}
      <p className="settings-provenance">{data.updatedBy ? `Last updated by ${data.updatedBy} · ${data.updatedAt}` : <span className="settings-defaults" title={data.defaultsSource}>{data.demoRoster === true ? "Demo defaults" : "Defaults"}</span>}</p>
      {roster.isError && <p role="alert">Ship list unavailable. Ship selections cannot be changed.</p>}
      <ContextForm data={data} commands={roster.isError ? [] : roster.data?.commands ?? []}
        canEdit={context.canEdit && !context.isError} rosterUnavailable={roster.isError || !roster.data}
        pending={update.isPending} returnTo={returnTo} save={(request) => update.mutateAsync(request)} />
    </div>}
  </section>;
}
