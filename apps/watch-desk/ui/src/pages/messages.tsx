import { Link, useSearchParams } from "react-router-dom";
import { useState } from "react";
import type { RouteMeta } from "../route-registry";
import { calendarReturn } from "../components/calendar-links";
import { useSource, useDebounced } from "../components/source-data";
import { MessageReader } from "../components/message-reader";
import { recordStatus } from "../components/message-format";
import { useDisplayTime } from "../components/display-time";
import { messageTitle, structuredIdentifiers } from "../components/structured-message-format";

export const route: RouteMeta = { path: "/messages", label: "Message records", order: 1 };

export default function Messages() {
  const { format: utc } = useDisplayTime();
  const [params, setParams] = useSearchParams();
  const record = params.get("record") ?? "";
  const [query, setQuery] = useState(params.get("q") ?? "");
  const debounced = useDebounced(query);
  const [pageToken, setPageToken] = useState<string>();
  const result = useSource(debounced.trim() ? "search" : "list", {
    query: debounced,
    mode: "hybrid",
    dataset: "canonical",
    pageToken,
  });
  const matches = result.data?.messages ?? [];
  const messages = matches;
  const detail = useSource(
    "detail",
    { key: record, dataset: record.startsWith("legacy:") ? "legacy" : "canonical" },
    !!record
  );
  const selected = detail.data?.messages[0];
  function update(key: string, value: string) {
    if (key === "q") {
      setPageToken(undefined);
      setQuery(value);
      return;
    }
    const next = new URLSearchParams(params);
    if (query) {
      next.set("q", query);
    } else {
      next.delete("q");
    }
    if (value) {
      next.set(key, value);
    } else {
      next.delete(key);
    }
    setParams(next, { replace: key === "q" });
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Message records</h1>
          <p>Source evidence, separate from the schedule.</p>
        </div>
      </div>
      <Link className="back-link" to={calendarReturn(params.get("returnTo"))}>
        <span aria-hidden="true">← </span>Return to Calendar
      </Link>
      <div className="search-region">
        <label htmlFor="record-search">Search Message records</label>
        <input
          id="record-search"
          className="input"
          type="search"
          value={query}
          placeholder="Message ID, subject, event or raw text"
          onChange={(e) => update("q", e.target.value)}
        />
        <button className="btn btn-ghost btn-sm" onClick={() => update("q", "")}>
          Clear search
        </button>
      </div>
      {result.isPending ? (
        <p role="status">Loading Message records…</p>
      ) : result.isError ? (
        <div role="alert" className="alert">
          Message records could not be loaded. {result.error.message} No schedule data is confirmed.
          <button className="btn btn-sm" onClick={() => void result.refetch()}>
            Retry
          </button>
        </div>
      ) : (
        <>
          <p className="feature-note">
            {result.data.notice} · {result.data.source} · Read at {utc(result.data.retrievedAt)}
          </p>
          {messages.length === 0 && (
            <div className="unfinished">
              <h2>No Message records available</h2>
              <p>The source returned an empty dataset.</p>
              <button className="btn btn-sm" onClick={() => void result.refetch()}>
                Retry
              </button>
            </div>
          )}
          <div className="messages-workspace">
            <section aria-label="Message record list" className="record-list">
              <h2>{matches.length} records in this result window</h2>
              {result.data.meta.windowLimited === true && (
                <p>Search candidate limit reached. Narrow your search.</p>
              )}
              {(pageToken ?? "") !== "" && (
                <button className="btn btn-sm" onClick={() => setPageToken(undefined)}>
                  First page
                </button>
              )}
              {(result.data.meta.nextPageToken ?? "") !== "" && (
                <button
                  className="btn btn-sm"
                  onClick={() => setPageToken(result.data.meta.nextPageToken)}
                >
                  Next page
                </button>
              )}
              {matches.length === 0 && messages.length > 0 && (
                <p>No search matches. Clear search to restore all records.</p>
              )}
              {matches.map((m) => (
                <button
                  key={String(m.id)}
                  className="record-entry"
                  aria-pressed={record === m.sourceMessageId}
                  onClick={() => update("record", m.sourceMessageId)}
                >
                  <span className="record-id">{m.sourceMessageId}</span>
                  <strong>{messageTitle(m)}</strong>
                  {m.structuredPayloadJson !== undefined && (
                    <span className="review-cue">{structuredIdentifiers(m)}</span>
                  )}
                  <span>Open record for receipt details and extracted facts.</span>
                  {result.data.meta.matchedExcerpts?.[m.sourceMessageId]?.map((excerpt) => (
                    <span key={excerpt.passageId}>{excerpt.text}</span>
                  ))}
                  <span className={m.processingStatus === "parsed" ? "" : "review-cue"}>
                    {recordStatus(m.processingStatus)}
                  </span>
                </button>
              ))}
            </section>
            {record && detail.isPending ? (
              <p role="status">Loading selected message…</p>
            ) : record && detail.isError ? (
              <div role="alert">
                Selected message could not be loaded: {detail.error.message}
                <button className="btn btn-sm" onClick={() => void detail.refetch()}>
                  Retry selected message
                </button>
              </div>
            ) : selected ? (
              <MessageReader key={selected.sourceMessageId} message={selected} />
            ) : (
              <section className="reader-empty">
                <h2>{record ? "Message record not found" : "Select a Message record"}</h2>
                <p>
                  {record
                    ? `The requested record ${record} is unavailable. No other record has been substituted.`
                    : "Choose a source to inspect its raw message and extracted fields."}
                </p>
                {record && (
                  <button className="btn btn-sm" onClick={() => void result.refetch()}>
                    Retry
                  </button>
                )}
              </section>
            )}
          </div>
        </>
      )}
    </>
  );
}
