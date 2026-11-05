import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fromJson, type JsonValue } from "@bufbuild/protobuf";
import { ReadSchedulesResponseSchema } from "../gen/app/v1/source_data_pb";
import { sessionFetch } from "./session-access";

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
    casualtySerials?: string[];
    casualtyUics?: string[];
    casualtyCategories?: string[];
    casualtyReportTypes?: string[];
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
  sourceType?: string;
  title: string;
  kind: "point" | "interval" | "unresolved";
  at?: string;
  start?: string;
  end?: string;
  reason?: string;
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
    throw new Error(
      typeof payload.message === "string" ? payload.message : "Source read failed; retry shortly"
    );
  }
  return payload;
}
export function useSource(operation: string, request: SourceRequest, enabled = true) {
  return useQuery({
    queryKey: ["parse-command-source", operation, request],
    queryFn: ({ signal }) => readSource(operation, request, signal),
    enabled,
    retry: false,
    staleTime: 15_000,
    gcTime: 60_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
}
export function useDebounced(value: string) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), 300);
    return () => clearTimeout(timer);
  }, [value]);
  return debounced;
}
