import { useState } from "react";
import { TbFilter, TbArrowsSort, TbChevronLeft, TbChevronRight, TbCheck } from "react-icons/tb";
import { Popover } from "./popover";
import type { MessageSort, SourceMeta } from "./source-data";
import type { MessageFilters } from "./message-search-state";

function FilterForm({
  initial,
  options,
  pending,
  failed,
  retry,
  onApply,
}: {
  initial: MessageFilters;
  options?: SourceMeta["filterOptions"];
  pending: boolean;
  failed: boolean;
  retry: () => void;
  onApply: (filters: MessageFilters) => void;
}) {
  const [draft, setDraft] = useState(initial);
  const types = options?.messageTypes ?? [];
  const senders = options?.originators ?? [];
  return (
    <form
      className="message-filter-form"
      onSubmit={(event) => {
        event.preventDefault();
        const values = new FormData(event.currentTarget);
        onApply({
          messageType: String(values.get("messageType") ?? ""),
          sender: String(values.get("sender") ?? ""),
          fromDate: String(values.get("fromDate") ?? ""),
          throughDate: String(values.get("throughDate") ?? ""),
        });
      }}
    >
      <label>
        Message type
        <select
          className="select select-sm"
          name="messageType"
          value={draft.messageType}
          onChange={(e) => setDraft({ ...draft, messageType: e.target.value })}
        >
          <option value="">All message types</option>
          {draft.messageType !== "" && !types.includes(draft.messageType) && (
            <option>{draft.messageType}</option>
          )}
          {types.map((type) => (
            <option key={type}>{type}</option>
          ))}
        </select>
      </label>
      <label>
        Sender
        <select
          className="select select-sm"
          name="sender"
          title="MSGID originating command"
          value={draft.sender}
          onChange={(e) => setDraft({ ...draft, sender: e.target.value })}
        >
          <option value="">All senders</option>
          {draft.sender !== "" && !senders.includes(draft.sender) && (
            <option>{draft.sender}</option>
          )}
          {senders.map((sender) => (
            <option key={sender}>{sender}</option>
          ))}
        </select>
      </label>
      <label>
        Issued from (Zulu)
        <input
          className="input input-sm"
          type="date"
          name="fromDate"
          value={draft.fromDate}
          onChange={(e) => setDraft({ ...draft, fromDate: e.target.value })}
        />
      </label>
      <label>
        Issued through (Zulu)
        <input
          className="input input-sm"
          type="date"
          name="throughDate"
          value={draft.throughDate}
          onChange={(e) => setDraft({ ...draft, throughDate: e.target.value })}
        />
      </label>
      {pending && <p role="status">Loading filter options…</p>}
      {failed && (
        <p role="alert">
          Filter options unavailable.{" "}
          <button className="btn btn-ghost btn-xs" type="button" onClick={retry}>
            Retry options
          </button>
        </p>
      )}
      <div className="message-filter-actions">
        <button
          className="btn btn-ghost btn-sm"
          type="button"
          onClick={() => onApply({ messageType: "", sender: "", fromDate: "", throughDate: "" })}
        >
          Clear filters
        </button>
        <button className="btn btn-primary btn-sm" type="submit">
          Apply filters
        </button>
      </div>
    </form>
  );
}
export function MessageSearchControls({
  fields,
  sort,
  query,
  activeFilters,
  options,
  optionsPending,
  optionsFailed,
  retryOptions,
  onApply,
  onSort,
}: {
  fields: MessageFilters;
  sort: MessageSort;
  query: string;
  activeFilters: number;
  options?: SourceMeta["filterOptions"];
  optionsPending: boolean;
  optionsFailed: boolean;
  retryOptions: () => void;
  onApply: (filters: MessageFilters) => void;
  onSort: (sort: MessageSort) => void;
}) {
  return (
    <>
      <Popover
        label="Message filters"
        align="end"
        trigger={
          <>
            <TbFilter aria-hidden="true" />
            {activeFilters > 0 && <span>{activeFilters}</span>}
          </>
        }
      >
        {({ close }) => (
          <FilterForm
            initial={fields}
            options={options}
            pending={optionsPending}
            failed={optionsFailed}
            retry={retryOptions}
            onApply={(value) => {
              onApply(value);
              close();
            }}
          />
        )}
      </Popover>
      <Popover label="Sort results" align="end" trigger={<TbArrowsSort aria-hidden="true" />}>
        {({ close }) => (
          <div role="menu" aria-label="Result sort order" className="message-sort-menu">
            {(
              [
                ["relevance", "Relevance"],
                ["issued_desc", "Issue time — newest first"],
                ["issued_asc", "Issue time — oldest first"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                className="btn btn-ghost btn-sm"
                role="menuitemradio"
                aria-checked={value === sort}
                disabled={value === "relevance" && query.trim() === ""}
                onClick={() => {
                  onSort(value);
                  close();
                }}
              >
                <span>{label}</span>
                {value === sort && <TbCheck aria-hidden="true" />}
              </button>
            ))}
          </div>
        )}
      </Popover>
    </>
  );
}
export function MessagePagination({
  meta,
  count,
  pending,
  failed,
  onPage,
}: {
  meta?: SourceMeta;
  count: number;
  pending: boolean;
  failed: boolean;
  onPage: (token: string) => void;
}) {
  const previous = meta?.previousPageToken;
  const next = meta?.nextPageToken;
  const total = meta?.totalRecords ?? count;
  return (
    <div className="message-search-summary">
      <span role="status">
        {failed
          ? "Results unavailable"
          : pending
            ? "Loading…"
            : `${total.toLocaleString()}${meta?.totalRelation === "gte" ? "+" : ""} ${meta?.countScope === "ranked_matches" ? "top matches" : "records"}`}
      </span>
      <nav aria-label="Message result pages">
        <button
          className="btn btn-ghost btn-xs"
          type="button"
          aria-label="Previous results page"
          disabled={pending || failed || (previous ?? "") === ""}
          onClick={() => {
            if (typeof previous === "string" && previous !== "") {
              onPage(previous);
            }
          }}
        >
          <TbChevronLeft aria-hidden="true" />
        </button>
        <span aria-label="Results page">
          {meta?.page ?? 1}
          {typeof meta?.totalPages === "number" ? ` / ${meta.totalPages}` : ""}
        </span>
        <button
          className="btn btn-ghost btn-xs"
          type="button"
          aria-label="Next results page"
          disabled={pending || failed || (next ?? "") === ""}
          onClick={() => {
            if (typeof next === "string" && next !== "") {
              onPage(next);
            }
          }}
        >
          <TbChevronRight aria-hidden="true" />
        </button>
      </nav>
    </div>
  );
}
