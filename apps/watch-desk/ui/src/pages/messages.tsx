import { Link, useSearchParams } from "react-router-dom";
import { useRef, useState } from "react";
import { TbX } from "react-icons/tb";
import type { RouteMeta } from "../route-registry";
import { calendarReturn } from "../components/calendar-links";
import { useSource, useDebounced } from "../components/source-data";
import { MessageReader } from "../components/message-reader";
import { messageSearchState, type MessageFilters } from "../components/message-search-state";
import { MessageSearchControls, MessagePagination } from "../components/message-search-controls";
import { MessageSearchCard } from "../components/message-search-card";

export const route: RouteMeta = { path: "/messages", label: "Message records", order: 1 };

export default function Messages() {
  const [params, setParams] = useSearchParams();
  const record = params.get("record") ?? "";
  const query = params.get("q") ?? "";
  const debounced = useDebounced(query);
  const criteria = JSON.stringify(
    ["q", "messageType", "sender", "fromDate", "throughDate", "sort"].map((key) => params.get(key))
  );
  const [page, setPage] = useState<{ criteria: string; token?: string }>({ criteria: "" });
  const pageToken = page.criteria === criteria ? page.token : undefined;
  function setPageToken(token?: string) {
    setPage({ criteria, token });
  }
  const search = messageSearchState(params, debounced, pageToken);
  const waiting = query !== debounced;
  const result = useSource(
    debounced.trim() ? "search" : "list",
    search.request,
    !waiting && search.error === undefined
  );
  const options = useSource("options", { dataset: "canonical" });
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
    if (key !== "record") {
      setPageToken(undefined);
    }
    const next = new URLSearchParams(params);
    if (key === "record") {
      next.delete("tab");
    }
    if (value) {
      next.set(key, value);
    } else {
      next.delete(key);
    }
    setParams(next, { replace: key === "q" });
  }
  function applyFilters(fields: MessageFilters) {
    const next = new URLSearchParams(params);
    for (const key of ["messageType", "sender", "fromDate", "throughDate"] as const) {
      const value = fields[key];
      if (value === "") {
        next.delete(key);
      } else {
        next.set(key, value);
      }
    }
    setPageToken(undefined);
    setParams(next);
  }
  function retryResults() {
    if (pageToken === undefined) {
      void result.refetch();
    } else {
      setPageToken(undefined);
    }
  }
  return (
    <>
      <Link className="back-link" to={calendarReturn(params.get("returnTo"))}>
        <span aria-hidden="true">← </span>Return to Calendar
      </Link>
      <div className="search-region message-search-toolbar">
        <div className="message-search-label">
          <label htmlFor="record-search">Search Message records</label>
          <MessagePagination
            meta={result.data?.meta}
            count={matches.length}
            pending={result.isPending || waiting}
            failed={result.isError || search.error !== undefined}
            onPage={setPageToken}
          />
        </div>
        <input
          id="record-search"
          className="input"
          type="search"
          value={query}
          placeholder="Message ID, subject, event or raw text"
          onChange={(e) => update("q", e.target.value)}
        />
        <div className="message-search-actions">
          <button className="btn btn-ghost btn-sm" onClick={() => update("q", "")}>
            Clear search
          </button>
          <MessageSearchControls
            fields={search.fields}
            sort={search.sort}
            query={query}
            activeFilters={search.activeFilters}
            options={options.data?.meta.filterOptions}
            optionsPending={options.isPending}
            optionsFailed={options.isError}
            retryOptions={() => void options.refetch()}
            onApply={applyFilters}
            onSort={(value) => update("sort", value)}
          />
        </div>
      </div>
      {query.trim() && !waiting && !result.isFetching && !result.isError && result.data && <p className="calendar-search-status">
        Executed search: {result.data.meta.executedMode ?? "not reported by server"}.
        {result.data.meta.executedMode === "hybrid" ? " Related ranked results may have no exact word match; this is not an exhaustive keyword result set." : " Searches indexed narrative passages, not all event titles."}
      </p>}
      {search.error !== undefined ? (
        <div role="alert" className="alert">
          {search.error}
        </div>
      ) : result.isPending || waiting ? null : result.isError ? (
        <div role="alert" className="alert">
          Message records could not be loaded. {result.error.message} No schedule data is confirmed.
          <button className="btn btn-sm" onClick={retryResults}>
            Retry
          </button>
        </div>
      ) : (
        <>
          {messages.length === 0 && (
            <div className="unfinished">
              <h2>No Message records available</h2>
              <p>The source returned an empty dataset.</p>
              <button className="btn btn-sm" onClick={retryResults}>
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
                  <MessageReader
                    key={`${selected.sourceMessageId}:${params.get("tab") ?? ""}`}
                    message={selected}
                  />
                ) : record ? (
                  <section className="reader-empty">
                    <h2>Message record not found</h2>
                    <p>
                      The requested record {record} is unavailable. No other record has been
                      substituted.
                    </p>
                    <button className="btn btn-sm" onClick={retryResults}>
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
