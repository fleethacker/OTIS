import moment from "moment-timezone";
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
function dateStart(value: string, zone: string): number | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return;
  }
  const at = moment.tz(value, "YYYY-MM-DD", true, zone);
  return at.isValid() && at.format("YYYY-MM-DD") === value ? +at : undefined;
}
export function messageSearchState(
  params: URLSearchParams,
  query: string,
  pageToken?: string,
  zone = "UTC"
) {
  const fields = messageFilters(params);
  const from = fields.fromDate === "" ? undefined : dateStart(fields.fromDate, zone);
  const through = fields.throughDate === "" ? undefined : dateStart(fields.throughDate, zone);
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
    filters.issuedTo = moment.tz(through, zone).add(1, "day").toISOString();
  }
  const request: SourceRequest = {
    query,
    mode: params.get("mode") === "hybrid" ? "hybrid" : "keyword",
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
