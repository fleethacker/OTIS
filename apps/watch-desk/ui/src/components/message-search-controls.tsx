import { AppButton, Notice, SelectInput, TextInput } from "./ui";
import { useDisplayTime } from "./display-time";
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
  const { zone } = useDisplayTime();
  const [draft, setDraft] = useState(initial);
  const types = options?.messageTypes ?? [];
  const senders = options?.originators ?? [];
  return (
    <form
      className="message-filter-form"
      onSubmit={(event) => {
        event.preventDefault();
        const values = new FormData(event.currentTarget);
        const text = (name: string) => {
          const value = values.get(name);
          return typeof value === "string" ? value : "";
        };
        onApply({
          messageType: text("messageType"),
          sender: text("sender"),
          fromDate: text("fromDate"),
          throughDate: text("throughDate"),
        });
      }}
    >
      <label>
        Message type
        <SelectInput
          className="select-sm"
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
        </SelectInput>
      </label>
      <label>
        Sender
        <SelectInput
          className="select-sm"
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
        </SelectInput>
      </label>
      <label>
        Issued from ({zone === "UTC" ? "Zulu" : zone})
        <TextInput
          className="input-sm"
          type="date"
          name="fromDate"
          value={draft.fromDate}
          onChange={(e) => setDraft({ ...draft, fromDate: e.target.value })}
        />
      </label>
      <label>
        Issued through ({zone === "UTC" ? "Zulu" : zone})
        <TextInput
          className="input-sm"
          type="date"
          name="throughDate"
          value={draft.throughDate}
          onChange={(e) => setDraft({ ...draft, throughDate: e.target.value })}
        />
      </label>
      {pending && <p role="status">Loading filter options…</p>}
      {failed && (
        <Notice role="alert" tone="error">
          Filter options unavailable.{" "}
          <AppButton variant="ghost" size="xs" type="button" onClick={retry}>
            Retry options
          </AppButton>
        </Notice>
      )}
      <div className="message-filter-actions">
        <AppButton
          variant="ghost"
          size="sm"
          type="button"
          onClick={() => onApply({ messageType: "", sender: "", fromDate: "", throughDate: "" })}
        >
          Clear filters
        </AppButton>
        <AppButton variant="primary" size="sm" type="submit">
          Apply filters
        </AppButton>
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
              <AppButton
                key={value}
                variant="ghost"
                size="sm"
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
              </AppButton>
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
        <AppButton
          variant="ghost"
          size="xs"
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
        </AppButton>
        <span aria-label="Results page">
          {meta?.page ?? 1}
          {typeof meta?.totalPages === "number" ? ` / ${meta.totalPages}` : ""}
        </span>
        <AppButton
          variant="ghost"
          size="xs"
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
        </AppButton>
      </nav>
    </div>
  );
}
