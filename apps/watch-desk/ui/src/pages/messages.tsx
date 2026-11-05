import { Link, useSearchParams } from "react-router-dom";
import { useRef, useState } from "react";
import { TbX } from "react-icons/tb";
import type { RouteMeta } from "../route-registry";
import { calendarReturn } from "../components/calendar-links";
import { useSource, useDebounced } from "../components/source-data";
import { MessageReader } from "../components/message-reader";
import { MessageSearchCard } from "../components/message-search-card";

export const route: RouteMeta = { path: "/messages", label: "Message records", order: 1 };

export default function Messages() {
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
  const cardList = useRef<HTMLElement>(null);
  function closeMessage() {
    const card = cardList.current?.querySelector<HTMLButtonElement>(
      '.record-entry[aria-pressed="true"]'
    );
    (card ?? cardList.current)?.focus();
    update("record", "");
  }
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
          {messages.length === 0 && (
            <div className="unfinished">
              <h2>No Message records available</h2>
              <p>The source returned an empty dataset.</p>
              <button className="btn btn-sm" onClick={() => void result.refetch()}>
                Retry
              </button>
            </div>
          )}
          <div className="messages-workspace" data-reader-open={record.length > 0}>
            <section
              ref={cardList}
              tabIndex={-1}
              aria-label="Message record list"
              className="record-list"
            >
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
                <MessageSearchCard
                  key={m.sourceMessageId}
                  message={m}
                  header={result.data.meta.messageHeaders?.[m.sourceMessageId]}
                  selected={record === m.sourceMessageId}
                  onSelect={() => update("record", m.sourceMessageId)}
                />
              ))}
            </section>
            {record.length > 0 && (
              <div className="message-viewer">
                <button
                  type="button"
                  className="btn btn-ghost btn-xs message-viewer-close"
                  aria-label="Close message"
                  title="Close message"
                  onClick={closeMessage}
                >
                  <TbX aria-hidden="true" focusable="false" />
                </button>
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
                ) : record ? (
                  <section className="reader-empty">
                    <h2>Message record not found</h2>
                    <p>
                      The requested record {record} is unavailable. No other record has been
                      substituted.
                    </p>
                    <button className="btn btn-sm" onClick={() => void result.refetch()}>
                      Retry
                    </button>
                  </section>
                ) : null}
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
