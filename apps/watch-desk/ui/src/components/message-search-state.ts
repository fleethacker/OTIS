import type { MessageSort, SourceRequest } from "./source-data";

export interface MessageFilters {
  messageType: string;
  sender: string;
  fromDate: string;
  throughDate: string;
}
export function messageFilters(params: URLSearchParams): MessageFilters {
  return {
    messageType: params.get("messageType") ?? "",
    sender: params.get("sender") ?? "",
    fromDate: params.get("fromDate") ?? "",
    throughDate: params.get("throughDate") ?? "",
  };
}
function dateStart(value: string): number | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return;
  }
  const at = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(at) && new Date(at).toISOString().slice(0, 10) === value ? at : undefined;
}
export function messageSearchState(params: URLSearchParams, query: string, pageToken?: string) {
  const fields = messageFilters(params);
  const from = fields.fromDate === "" ? undefined : dateStart(fields.fromDate);
  const through = fields.throughDate === "" ? undefined : dateStart(fields.throughDate);
  let error: string | undefined;
  if (
    (fields.fromDate !== "" && from === undefined) ||
    (fields.throughDate !== "" && through === undefined) ||
    (through !== undefined && through + 86400000 > 253402300799999)
  ) {
    error = "Choose valid issue dates.";
  } else if (from !== undefined && through !== undefined && from > through) {
    error = "The issue-date end must be on or after its start.";
  }
  const selected = params.get("sort");
  const sort: MessageSort =
    selected === "issued_asc" || selected === "issued_desc"
      ? selected
      : query.trim() === ""
        ? "issued_desc"
        : "relevance";
  const filters: NonNullable<SourceRequest["filters"]> = {};
  if (fields.messageType !== "") {
    filters.messageTypes = [fields.messageType];
  }
  if (fields.sender !== "") {
    filters.originators = [fields.sender];
  }
  if (from !== undefined) {
    filters.issuedFrom = new Date(from).toISOString();
  }
  if (through !== undefined && error === undefined) {
    filters.issuedTo = new Date(through + 86400000).toISOString();
  }
  const request: SourceRequest = {
    query,
    mode: "hybrid",
    dataset: "canonical",
    sort,
    filters,
    pageToken,
  };
  return {
    request,
    sort,
    fields,
    error,
    activeFilters: [
      fields.messageType,
      fields.sender,
      fields.fromDate !== "" || fields.throughDate !== "" ? "date" : "",
    ].filter((v) => v !== "").length,
  };
}
