import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { messageHref } from "./calendar-links";
import { settingsRequest, type SettingsReply } from "./settings-data";

export interface ContextCitation {
  messageKey: string;
  auditId: string;
  setId: string;
  recordedAt: string;
  startByte: number;
  endByte: number;
  lineStart: number;
  lineEnd: number;
}
export interface ContextSuggestion {
  id: string;
  field: "operationName";
  values: string[];
  sources?: ContextCitation[];
}
export interface SuggestionsReply {
  suggestions: ContextSuggestion[];
  state: "available" | "unavailable";
  limited: boolean;
  revision: string;
}
function Citation({ source }: { source: ContextCitation }) {
  return <Link to={messageHref(source.messageKey, "/calendar")} title={`${source.setId} · ${source.messageKey}`}>
    {source.setId} message · {source.lineStart === source.lineEnd ? `line ${source.lineStart}` : `lines ${source.lineStart}–${source.lineEnd}`}
  </Link>;
}
/** Operation and exercise names found in messages, with line citations. Use and
 * Dismiss write through the audited shared-settings update. */
export function WatchSuggestions({ active, current, revision, dirty, onSaved }: {
  active: boolean; current: string; revision?: string; dirty: boolean; onSaved: (reply: SettingsReply) => void;
}) {
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState("");
  const query = useQuery({
    queryKey: ["settings", "suggestions"],
    queryFn: async () => {
      const reply = await settingsRequest<SuggestionsReply>("suggestions");
      if (!Array.isArray(reply.suggestions)) throw new Error("Suggestions response is invalid");
      return reply;
    },
    enabled: active, retry: false, staleTime: 15_000,
  });
  async function act(operation: "use-suggestion" | "dismiss-suggestion", suggestion: string) {
    setPending(true); setFailure("");
    try {
      onSaved(await settingsRequest<SettingsReply>(operation, { suggestion, revision }));
      await query.refetch();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "Could not save. Retry.");
    } finally { setPending(false); }
  }
  const data = query.data;
  const others = data?.suggestions.filter((s) => s.values[0] !== current) ?? [];
  return <section className="context-suggestions" aria-label="Source suggestions">
    <div className="settings-actions context-suggestions-heading">
      <h2>Suggestions from messages</h2>
      <button type="button" className="btn btn-sm" disabled={query.isFetching || pending} onClick={() => { void query.refetch(); }}>Refresh</button>
    </div>
    <p>Operation and exercise names found in recent messages. Choose Use to apply one.</p>
    {dirty && <p>Save or cancel your changes before using or dismissing a suggestion.</p>}
    {failure && <p role="alert">{failure}</p>}
    {query.isPending && <p role="status">Loading suggestions…</p>}
    {(query.isError || data?.state === "unavailable") && <p role="status">Suggestions are unavailable. Saved settings are still shown.</p>}
    {data?.state === "available" && data.suggestions.length === 0 && <p>No suggestions found in recent messages.</p>}
    {data?.limited && <p>More suggestions may be available.</p>}
    {others.length > 1 && <p className="context-conflict">Different names were found. Choose the one for this watch.</p>}
    {data?.suggestions.map((suggestion) => <article key={suggestion.id} className="context-suggestion">
      <h3>{suggestion.values.join(", ")}{suggestion.values[0] === current && <small> · matches current</small>}</h3>
      {suggestion.sources?.[0] ? <Citation source={suggestion.sources[0]} /> : <p>Source unavailable</p>}
      {(suggestion.sources?.length ?? 0) > 1 && <details><summary>+{suggestion.sources!.length - 1} more sources</summary>
        <ul>{suggestion.sources!.slice(1).map((s) => <li key={`${s.auditId}:${s.startByte}`}><Citation source={s} /></li>)}</ul></details>}
      <div className="settings-actions">
        <button type="button" className="btn btn-primary btn-sm" aria-label={`Use ${suggestion.values.join(", ")}`}
          disabled={pending || dirty || !revision || !suggestion.sources?.length} onClick={() => { void act("use-suggestion", suggestion.id); }}>Use</button>
        <button type="button" className="btn btn-sm" aria-label={`Dismiss ${suggestion.values.join(", ")}`}
          disabled={pending || dirty || !revision} onClick={() => { void act("dismiss-suggestion", suggestion.id); }}>Dismiss</button>
      </div>
    </article>)}
  </section>;
}
