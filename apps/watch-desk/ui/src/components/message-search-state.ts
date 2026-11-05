import moment from "moment-timezone";
import type { MessageSort, SourceRequest } from "./source-data";

export interface MessageFilters {
  messageType: string;
  sender: string;
  fromDate: string;
  throughDate: string;
  casualtySerial?: string;
  casualtyUic?: string;
  casualtyCategory?: string;
  casualtyReportType?: string;
  movementAction?: string;
  movementActivity?: string;
  movementUnit?: string;
  movementLocation?: string;
  movementFromDate?: string;
  movementThroughDate?: string;
}
export function messageFilters(params: URLSearchParams): MessageFilters {
  return {
    ...Object.fromEntries(
      ["casualtySerial", "casualtyUic", "casualtyCategory", "casualtyReportType", "movementAction", "movementActivity", "movementUnit", "movementLocation", "movementFromDate", "movementThroughDate"]
        .filter((key) => params.has(key))
        .map((key) => [key, params.get(key) ?? ""])
    ),
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
  const movementFrom = fields.movementFromDate === undefined || fields.movementFromDate === ""
    ? undefined : dateStart(fields.movementFromDate, zone);
  const movementThrough = fields.movementThroughDate === undefined || fields.movementThroughDate === ""
    ? undefined : dateStart(fields.movementThroughDate, zone);
  let error: string | undefined;
  if (
    (fields.fromDate !== "" && from === undefined) ||
    (fields.throughDate !== "" && through === undefined) ||
    (through !== undefined && through + 86400000 > 253402300799999)
  ) {
    error = "Choose valid issue dates.";
  } else if (from !== undefined && through !== undefined && from > through) {
    error = "The issue-date end must be on or after its start.";
  } else if ((fields.movementFromDate !== undefined && fields.movementFromDate !== "" && movementFrom === undefined) ||
    (fields.movementThroughDate !== undefined && fields.movementThroughDate !== "" && movementThrough === undefined) ||
    (movementThrough !== undefined && movementThrough + 86400000 > 253402300799999)) {
    error = "Choose valid movement dates.";
  } else if (movementFrom !== undefined && movementThrough !== undefined && movementFrom > movementThrough) {
    error = "The movement-date end must be on or after its start.";
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
  if (fields.casualtySerial !== undefined && fields.casualtySerial !== "") {
    filters.casualtySerials = [fields.casualtySerial];
  }
  if (fields.casualtyUic !== undefined && fields.casualtyUic !== "") {
    filters.casualtyUics = [fields.casualtyUic];
  }
  if (fields.casualtyCategory !== undefined && fields.casualtyCategory !== "") {
    filters.casualtyCategories = [fields.casualtyCategory];
  }
  if (fields.casualtyReportType !== undefined && fields.casualtyReportType !== "") {
    filters.casualtyReportTypes = [fields.casualtyReportType];
  }
  if (fields.movementAction !== undefined && fields.movementAction !== "") {
    filters.movementActions = [fields.movementAction];
  }
  if (fields.movementActivity !== undefined && fields.movementActivity !== "") {
    filters.movementActivities = [fields.movementActivity];
  }
  if (fields.movementUnit !== undefined && fields.movementUnit !== "") {
    filters.movementUnits = [fields.movementUnit];
  }
  if (fields.movementLocation !== undefined && fields.movementLocation !== "") {
    filters.movementLocations = [fields.movementLocation];
  }
  if (movementFrom !== undefined) {
    filters.movementFrom = new Date(movementFrom).toISOString();
  }
  if (movementThrough !== undefined && error === undefined) {
    filters.movementTo = moment.tz(movementThrough, zone).add(1, "day").toISOString();
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
      fields.casualtySerial ?? "",
      fields.casualtyUic ?? "",
      fields.casualtyCategory ?? "",
      fields.casualtyReportType ?? "",
      fields.movementAction ?? "",
      fields.movementActivity ?? "",
      fields.movementUnit ?? "",
      fields.movementLocation ?? "",
      fields.movementFromDate !== undefined && fields.movementFromDate !== "" ||
      fields.movementThroughDate !== undefined && fields.movementThroughDate !== "" ? "movement-date" : "",
      fields.fromDate !== "" || fields.throughDate !== "" ? "date" : "",
    ].filter((v) => v !== "").length,
  };
}
