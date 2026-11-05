import { sessionFetch } from "./session-access";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fromJson, type JsonValue } from "@bufbuild/protobuf";
import { ReadSchedulesResponseSchema } from "../gen/app/v1/source_data_pb";
import {
  isStationAssignment,
  useAccountSettings,
  useSession,
  type AccountSession,
  type StationAssignment,
} from "./session";

export type Dataset = "canonical" | "legacy";
export type MessageSort = "relevance" | "issued_desc" | "issued_asc";
export type SearchMode = "keyword" | "semantic" | "hybrid";
export interface SourceRequest {
  dataset?: Dataset;
  query?: string;
  mode?: SearchMode;
  sort?: MessageSort;
  key?: string;
  pageToken?: string;
  from?: string;
  to?: string;
  filters?: {
    commandIds?: string[];
    messageTypes?: string[];
    originators?: string[];
    classifications?: string[];
    issuedFrom?: string;
    issuedTo?: string;
    unassignedOnly?: boolean;
    noCommands?: boolean;
  };
}
export interface TimelineItem {
  key: string;
  messageKey: string;
  factId?: string;
  /** Audited rule fact; factId is the stable ruleFactId@instant for an occurrence. */
  sourceFactId?: string;
  recurrence?: {
    ruleFactId: string;
    occurrenceId: string;
    rule: string;
    description: string;
    ongoing: boolean;
  };
  /** Explicit message-level applicability from the canonical source, never event.unit. */
  commandIds?: string[];
  sourceType?: string;
  title: string;
  kind: "point" | "interval" | "unresolved";
  at?: string;
  start?: string;
  end?: string;
  reason?: string;
  reasonCode?: "non_positive_interval" | "missing_time" | "unresolved_time";
  timeDetails?: {
    endpoint: string;
    status?: string;
    clock?: string;
    label?: string;
    at?: string;
  }[];
  reviewRequired: boolean;
}
export interface MessageHeader {
  type?: string;
  originator?: string;
  issuedAt?: string;
}
export interface SourceMeta {
  messageHeaders?: Record<string, MessageHeader>;
  dataset?: Dataset;
  currentPageToken?: string;
  previousPageToken?: string | null;
  nextPageToken?: string | null;
  page?: number;
  pageSize?: number;
  totalRecords?: number;
  totalPages?: number | null;
  totalRelation?: "eq" | "gte";
  countScope?: "records" | "ranked_matches";
  filterOptions?: { messageTypes: string[]; originators: string[] };
  executedMode?: string;
  windowLimited?: boolean;
  timelineItems?: TimelineItem[];
  reviewItems?: TimelineItem[];
  matchedExcerpts?: Record<string, { passageId: string; text: string }[]>;
  similarTo?: { messageKey: string; subject: string };
  effectiveScope?: EffectiveMessageScope;
  stationContext?: {
    stationAssignment: StationAssignment | null;
    effectiveScope: EffectiveMessageScope;
  };
  candidateLimit?: number;
}
export interface EffectiveMessageScope {
  allCommands: boolean;
  commandIds: string[];
  includeUnassigned: boolean;
  messageTypes: string[] | null;
  matchNone: boolean;
}
export function sourceScopeKey(session: AccountSession | null) {
  return [
    session?.settings.messageScope ?? null,
    session?.user?.stationAssignment ?? null,
    session?.stationAssignmentRequired ?? false,
  ];
}
export function isEffectiveMessageScope(value: unknown): value is EffectiveMessageScope {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const scope = value as Record<string, unknown>;
  const strings = (list: unknown) =>
    Array.isArray(list) && list.every((item) => typeof item === "string");
  return (
    typeof scope.allCommands === "boolean" &&
    typeof scope.includeUnassigned === "boolean" &&
    typeof scope.matchNone === "boolean" &&
    strings(scope.commandIds) &&
    (scope.messageTypes === null || strings(scope.messageTypes))
  );
}
export function isSourceObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function validSimilarMeta(value: unknown): value is SourceMeta {
  if (!isSourceObject(value) || !isSourceObject(value.similarTo)) {
    return false;
  }
  const anchor = value.similarTo;
  const context = value.stationContext;
  const excerpts = value.matchedExcerpts;
  return (
    typeof anchor.messageKey === "string" &&
    anchor.messageKey !== "" &&
    typeof anchor.subject === "string" &&
    isEffectiveMessageScope(value.effectiveScope) &&
    (context === undefined ||
      (isSourceObject(context) &&
        (context.stationAssignment === null || isStationAssignment(context.stationAssignment)) &&
        isEffectiveMessageScope(context.effectiveScope))) &&
    (excerpts === undefined ||
      (isSourceObject(excerpts) &&
        Object.values(excerpts).every(
          (items) =>
            Array.isArray(items) &&
            items.every(
              (item: unknown) =>
                isSourceObject(item) &&
                typeof item.passageId === "string" &&
                typeof item.text === "string"
            )
        )))
  );
}
export class SourceError extends Error {
  constructor(
    message: string,
    public readonly code: string
  ) {
    super(message);
    this.name = "SourceError";
  }
}
export async function readSource(operation: string, request: SourceRequest, signal?: AbortSignal) {
  const response = await sessionFetch(`/api/v1/messages/${operation}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(request),
    signal,
  });
  const payload = await readJson(response);
  const { meta, ...data } = payload;
  if (
    operation === "similar" &&
    (!validSimilarMeta(meta) || meta.similarTo?.messageKey !== request.key)
  ) {
    throw new Error("Similar message results could not be verified. Please retry.");
  }
  return {
    ...fromJson(ReadSchedulesResponseSchema, data),
    meta: (meta ?? {}) as unknown as SourceMeta,
  };
}
export async function readJson(response: Response) {
  const payload = (await response.json()) as JsonValue;
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Invalid source response");
  }
  if (!response.ok) {
    throw new SourceError(
      typeof payload.message === "string" ? payload.message : "Source read failed; retry shortly",
      typeof payload.code === "string" ? payload.code : "unknown"
    );
  }
  return payload;
}
export function useSource(operation: string, request: SourceRequest, enabled = true) {
  const settings = useAccountSettings();
  const { session } = useSession();
  const result = useQuery({
    queryKey: [
      "parse-command-source",
      operation,
      request,
      session?.user?.id ?? "anonymous",
      sourceScopeKey(session),
    ],
    queryFn: ({ signal }) => readSource(operation, request, signal),
    enabled,
    retry: false,
    staleTime: 15_000,
    gcTime: 60_000,
    refetchInterval:
      operation === "timeline"
        ? settings.calendarRefreshSeconds === 0
          ? false
          : settings.calendarRefreshSeconds * 1000
        : 30_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
  });
  const denied =
    result.error instanceof SourceError &&
    ["permission_denied", "unauthenticated", "failed_precondition"].includes(result.error.code);
  return denied ? { ...result, data: undefined } : result;
}
export function useDebounced(value: string) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), 300);
    return () => clearTimeout(timer);
  }, [value]);
  return debounced;
}
