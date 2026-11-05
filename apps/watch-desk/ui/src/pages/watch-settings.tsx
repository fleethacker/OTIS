import { useId, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { RouteMeta } from "../route-registry";
import { calendarReturn, messageHref } from "../components/calendar-links";
import { useCommands, type Command } from "../components/command-roster";
import {
  useWatchContext,
  useUpdateContext,
  type ContextCitation,
  type ContextField,
  type ContextResponse,
  type ContextUpdate,
} from "../components/watch-context";

export const route: RouteMeta = { path: "/watch-settings", label: "Watch settings", order: 2 };
const fields: [ContextField, string][] = [
  ["ownShipId", "Own ship"],
  ["shipName", "Display ship name"],
  ["operationName", "Operation / exercise"],
  ["groupCommand", "Group / command"],
  ["defaultShips", "Default visible ships"],
  ["turnoverUtc", "UTC watch turnovers"],
];
function Citation({ source, returnTo }: { source: ContextCitation; returnTo: string }) {
  if (!source.messageKey) {
    return <span>Source unavailable</span>;
  }
  return (
    <Link to={messageHref(source.messageKey, returnTo)}>
      {source.setId} · {source.messageKey} · lines {source.lineStart}–{source.lineEnd}
    </Link>
  );
}
function ContextForm({
  data,
  commands,
  canEdit,
  rosterUnavailable,
  pending,
  returnTo,
  save,
}: {
  data: ContextResponse;
  commands: Command[];
  canEdit: boolean;
  rosterUnavailable: boolean;
  pending: boolean;
  returnTo: string;
  save: (request: ContextUpdate) => Promise<unknown>;
}) {
  const id = useId();
  // Overrides survive failed saves and background reads. Unedited fields follow the server.
  const [draft, setDraft] = useState<Partial<Record<ContextField, string[]>>>({});
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  function current(field: ContextField) {
    const value = data.context[field];
    return field === "turnoverUtc"
      ? [data.context.turnoverUtc.join(", ")]
      : typeof value === "string"
        ? [value]
        : value;
  }
  const changed = fields.filter(
    ([field]) =>
      draft[field] !== undefined && JSON.stringify(draft[field]) !== JSON.stringify(current(field))
  );
  const dirty = changed.length > 0;
  const hides =
    changed.some(([field]) => field === "defaultShips") &&
    !(draft.defaultShips ?? []).includes("unassigned:");
  const busy = pending || saving;
  const choices = [
    ...commands.map((c) => [`unit:${c.id}`, c.name]),
    ["unassigned:", "Unassigned / needs applicability review"],
  ];
  const set = (field: ContextField, values: string[]) => {
    setDraft((previous) => ({ ...previous, [field]: values }));
    if (field === "defaultShips") {
      setConfirm(false);
    }
  };
  function reset() {
    setDraft({});
    setConfirm(false);
    setError("");
  }
  async function suggest(suggestionId: string, dismiss = false) {
    setError("");
    setSaving(true);
    try {
      await save({ suggestionId, ...(dismiss ? { dismiss: true } : {}) });
    } catch (error) {
      setError(error instanceof Error ? error.message : "Update unavailable");
    } finally {
      setSaving(false);
    }
  }
  async function submit() {
    if (!canEdit || busy || !dirty || (hides && !confirm)) {
      return;
    }
    setSaving(true);
    setError("");
    try {
      await save({
        changes: changed.map(([field]) => {
          const values = draft[field] ?? current(field);
          return {
            field,
            values: field === "turnoverUtc" ? values[0].split(",").map((v) => v.trim()) : values,
            ...(field === "defaultShips" && hides ? { confirmHideUnassigned: confirm } : {}),
          };
        }),
      });
      reset();
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Save result unavailable; refresh before retrying"
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <>
      <form
        aria-label="Watch settings"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {fields.map(([field, label]) => {
          const values = draft[field] ?? current(field);
          const confirmation = data.confirmations[field];
          return (
            <div className="context-editor" key={field}>
              <fieldset
                disabled={
                  !canEdit ||
                  busy ||
                  ((field === "ownShipId" || field === "defaultShips") && rosterUnavailable)
                }
              >
                <legend>{label}</legend>
                {field === "ownShipId" ? (
                  <select
                    className="select select-sm"
                    aria-label={label}
                    value={values[0]}
                    onChange={(e) => set(field, [e.target.value])}
                  >
                    <option value="">Not set</option>
                    {commands.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                ) : field === "defaultShips" ? (
                  <div className="context-ship-options">
                    {choices.map(([key, name]) => (
                      <label key={key}>
                        <input
                          type="checkbox"
                          checked={values.includes(key)}
                          onChange={(e) =>
                            set(
                              field,
                              e.target.checked ? [...values, key] : values.filter((v) => v !== key)
                            )
                          }
                        />
                        {name}
                      </label>
                    ))}
                  </div>
                ) : (
                  <input
                    className="input input-sm"
                    aria-label={label}
                    value={values[0]}
                    maxLength={field === "turnoverUtc" ? 192 : 128}
                    onChange={(e) => set(field, [e.target.value])}
                  />
                )}
                {field === "shipName" && (
                  <p>
                    Display override only; does not change roster IDs, tasking or acknowledgement
                    authority.
                  </p>
                )}
                {field === "turnoverUtc" && (
                  <p>
                    Comma-separated UTC values, e.g. 0000Z, 0400Z. Does not change the calendar
                    display zone.
                  </p>
                )}
                {field === "defaultShips" && (
                  <p>
                    Applied explicitly with “Use app defaults” in the sidebar; shared URLs retain
                    their own selection.
                  </p>
                )}
                {field === "defaultShips" && hides && (
                  <label htmlFor={id} className="context-hide-confirm">
                    <input
                      id={id}
                      type="checkbox"
                      checked={confirm}
                      onChange={(e) => setConfirm(e.target.checked)}
                    />
                    I confirm hiding Unassigned from app-wide defaults.
                  </label>
                )}
              </fieldset>
              {confirmation && (
                <p className="context-confirmation">
                  Confirmed by {confirmation.actor} · {confirmation.recordedAt}
                  {(confirmation.sources ?? []).map((source) => (
                    <span key={`${source.auditId}:${source.startByte}`}>
                      {" "}
                      · <Citation source={source} returnTo={returnTo} />
                    </span>
                  ))}
                  {(confirmation.sources?.length ?? 0) === 0 && " · Manual entry"}
                </p>
              )}
            </div>
          );
        })}
        <div className="context-actions">
          <button
            className="btn btn-primary btn-sm"
            disabled={
              !canEdit ||
              busy ||
              !dirty ||
              (hides && !confirm) ||
              (rosterUnavailable &&
                changed.some(([f]) => f === "ownShipId" || f === "defaultShips"))
            }
          >
            {saving ? "Saving…" : "Save settings"}
          </button>
          <button type="button" className="btn btn-sm" disabled={!dirty || busy} onClick={reset}>
            Cancel changes
          </button>
          <p role="status">{dirty ? "Unsaved changes" : "No unsaved changes"}</p>
        </div>
      </form>
      {error && <p role="alert">{error}</p>}
      <section className="context-suggestions" aria-label="Source suggestions">
        <h2>Source suggestions — human confirmation required</h2>
        <p>
          Verified EXER/OPER metadata only. Own ship, Group / command and default ships are manual;
          sender/addressees are not applicability.
        </p>
        <p>
          {data.suggestionScope}
          {data.suggestionsLimited ? " · Limited results" : ""}
        </p>
        {dirty && <p>Save or cancel manual changes before using or dismissing a suggestion.</p>}
        {data.suggestionState === "unavailable" && (
          <p role="status">Source suggestions unavailable; manual context remains editable.</p>
        )}
        {data.suggestionState === "available" && data.suggestions.length === 0 && (
          <p>No suggestions in the returned metadata.</p>
        )}
        {data.suggestions.filter((s) => s.values[0] !== data.context.operationName).length > 1 && (
          <p className="context-conflict">
            Conflicting source values; choose explicitly. No automatic overwrite.
          </p>
        )}
        {data.suggestions.map((suggestion) => (
          <article key={suggestion.id} className="context-suggestion">
            <h3>
              {suggestion.values.join(", ")}
              {suggestion.values[0] === data.context.operationName && (
                <small> · matches current</small>
              )}
            </h3>
            {suggestion.sources?.[0] ? (
              <Citation source={suggestion.sources[0]} returnTo={returnTo} />
            ) : (
              <p>Source unavailable</p>
            )}
            {(suggestion.sources?.length ?? 0) > 1 && (
              <details>
                <summary>+{(suggestion.sources ?? []).length - 1} more sources</summary>
                <ul>
                  {(suggestion.sources ?? []).slice(1).map((s) => (
                    <li key={`${s.auditId}:${s.startByte}`}>
                      <Citation source={s} returnTo={returnTo} />
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <div className="context-actions">
              <button
                className="btn btn-sm"
                disabled={!canEdit || busy || dirty || (suggestion.sources?.length ?? 0) === 0}
                onClick={() => {
                  void suggest(suggestion.id);
                }}
              >
                Use {suggestion.values.join(", ")}
              </button>
              <button
                className="btn btn-sm"
                disabled={!canEdit || busy || dirty}
                onClick={() => {
                  void suggest(suggestion.id, true);
                }}
              >
                Dismiss {suggestion.values.join(", ")}
              </button>
            </div>
          </article>
        ))}
      </section>
    </>
  );
}
export default function Settings() {
  const context = useWatchContext(true);
  const roster = useCommands();
  const update = useUpdateContext();
  const [params] = useSearchParams();
  const returnTo = calendarReturn(params.get("returnTo"));
  const data = context.data;
  return (
    <section className="watch-settings" aria-labelledby="settings-heading">
      <Link className="back-link" to={returnTo}>
        Return to Calendar
      </Link>
      <h1 id="settings-heading">Watch settings</h1>
      <button
        className="btn btn-sm"
        disabled={context.isFetching || update.isPending}
        onClick={() => {
          void context.refetch();
        }}
      >
        Refresh context and suggestions
      </button>
      <p>
        App-wide display defaults, not tasking, access control or acknowledgement authority.
        Concurrent edits are last-write-wins for changed fields; no durable change history in this
        demo. Refresh preserves unsaved edits; Cancel resets them to the latest loaded settings.
      </p>
      {context.isPending && <p role="status">Loading watch context…</p>}
      {context.isError && (
        <p role="alert">
          Context unavailable.{" "}
          <button
            className="btn btn-sm"
            onClick={() => {
              void context.refetch();
            }}
          >
            Retry context
          </button>
        </p>
      )}
      {data && (
        <div key={context.identityKey}>
          {!context.canEdit && <p>Read only. An administrator must change shared context.</p>}
          <p>
            {(data.updatedBy ?? "") !== ""
              ? `Last update: ${data.updatedBy} · ${data.updatedAt}`
              : `Unconfirmed ${data.demoRoster === true ? "demo defaults" : "defaults"} · ${data.defaultsSource}`}
          </p>
          {roster.isError && (
            <p role="alert">Roster unavailable; ship selection cannot be edited.</p>
          )}
          <ContextForm
            data={data}
            commands={roster.isError ? [] : (roster.data?.commands ?? [])}
            canEdit={context.canEdit && !context.isError}
            rosterUnavailable={roster.isError || !roster.data}
            pending={update.isPending}
            returnTo={returnTo}
            save={(request) => update.mutateAsync(request)}
          />
        </div>
      )}
    </section>
  );
}
