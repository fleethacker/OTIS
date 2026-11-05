import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { readJson } from "./source-data";
import { sessionFetch } from "./session-access";
import { useWatchSession } from "./watch-session";

export interface AddedEvent {
  key?: string;
  factId?: string;
  title?: string | null;
  at?: string;
  start?: string;
  end?: string;
  commandIds?: string[];
  /** "recurring" for a standalone recurrence rule with no single time. */
  kind?: string;
  recurring?: boolean;
  recurrence?: boolean | { rule?: string; description?: string };
}
export type ChangeWatermark = number | string;

export interface WatchChange {
  id: string;
  messageKey: string | null;
  receiptId: string | null;
  sequence: number | null;
  title: string;
  commandIds: string[];
  /** Source issue time (message DTG): when the originator sent it. */
  issuedAt: string | null;
  /** First receipt by this desk; custody metadata, not send time. */
  recordedAt: string | null;
  basis: "source_issue_time" | "issue_time_unavailable";
  sender?: string;
  /** Absent means the server does not expose per-person review state. */
  reviewedAt?: string | null;
  addedEvents?: AddedEvent[];
  eventsLimited?: boolean;
}
export interface ChangePage {
  items: WatchChange[];
  unknownTime: WatchChange[];
  unknownHiddenCount: number;
  unknownLimited: boolean;
  returnedNewCount: number;
  hiddenCount: number;
  hiddenShipIds: string[];
  nextBefore: number | null;
  watermark: ChangeWatermark;
  since: string;
  basis?: "last_seen" | "turnover" | "default_24h";
  until: string;
  availability: { newRecords: string; amended: string; cancelled: string; reviewTransitions: string };
  scope: string;
}
export interface ChangeRequest {
  since?: string;
  until: string;
  filters: { commandIds?: string[]; unassignedOnly?: boolean; noCommands?: boolean };
  before?: number;
  watermark?: ChangeWatermark;
}
export async function readChanges(request: ChangeRequest, signal?: AbortSignal): Promise<ChangePage> {
  const payload = await readJson(await sessionFetch("/api/v1/changes/list", {
    method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request), signal,
  }));
  const result = payload as unknown as ChangePage;
  if (!Array.isArray(result.items) || !Array.isArray(result.unknownTime) || !result.availability ||
      ![result.returnedNewCount, result.hiddenCount, result.unknownHiddenCount].every((v) => Number.isSafeInteger(v) && v >= 0) ||
      !(typeof result.watermark === "string" ? result.watermark.length > 0 : Number.isSafeInteger(result.watermark) && result.watermark >= 0) ||
      result.items.length + result.hiddenCount !== result.returnedNewCount ||
      !(result.nextBefore === null || (Number.isSafeInteger(result.nextBefore) && result.nextBefore > 0)) ||
      result.items.some((row) => !row.issuedAt || !Number.isFinite(Date.parse(row.issuedAt)))) {
    throw new Error("Turnover response is invalid");
  }
  for (const row of [...result.items, ...result.unknownTime]) {
    if ((row.reviewedAt !== undefined && row.reviewedAt !== null && (typeof row.reviewedAt !== "string" || !Number.isFinite(Date.parse(row.reviewedAt)))) ||
        (row.addedEvents !== undefined && (!Array.isArray(row.addedEvents) || row.addedEvents.length > 20 || row.addedEvents.some((event) => !event || (event.title !== undefined && event.title !== null && typeof event.title !== "string"))))) {
      throw new Error("Turnover response is invalid");
    }
  }
  return result;
}
export function useChanges(request: ChangeRequest, enabled: boolean) {
  const session = useWatchSession();
  return useInfiniteQuery({
    queryKey: ["watchdesk-changes", session?.scope ?? "legacy", session?.since ?? null, request],
    initialPageParam: null as { before: number; watermark: ChangeWatermark } | null,
    queryFn: ({ pageParam, signal }) => readChanges({ ...request, ...(pageParam ?? {}) }, signal),
    getNextPageParam: (last) => last.nextBefore === null ? undefined : { before: last.nextBefore, watermark: last.watermark },
    enabled, retry: false, staleTime: 15_000, gcTime: 60_000,
    refetchOnWindowFocus: false,
  });
}

export function useReviewChanges() {
  const client = useQueryClient();
  const session = useWatchSession();
  return useMutation({
    // review-all must echo the list response window and filters so it marks exactly what was shown.
    mutationFn: async (request: { messageKeys: string[] } | { watermark: ChangeWatermark; since: string; until: string; filters: ChangeRequest["filters"] }) => {
      if ("messageKeys" in request && (!request.messageKeys.length || request.messageKeys.length > 200)) throw new Error("Choose up to 200 messages.");
      return readJson(await sessionFetch(`/api/v1/changes/${"watermark" in request ? "review-all" : "review"}`, {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request),
      }));
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ["watchdesk-changes", session?.scope ?? "legacy"] }),
  });
}
