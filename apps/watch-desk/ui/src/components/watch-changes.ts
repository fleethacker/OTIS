import { useInfiniteQuery } from "@tanstack/react-query";
import { readJson } from "./source-data";

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
  watermark: number;
  since: string;
  until: string;
  availability: { newRecords: string; amended: string; cancelled: string; reviewTransitions: string };
  scope: string;
}
export interface ChangeRequest {
  since: string;
  until: string;
  filters: { commandIds?: string[]; unassignedOnly?: boolean; noCommands?: boolean };
  before?: number;
  watermark?: number;
}
export async function readChanges(request: ChangeRequest, signal?: AbortSignal): Promise<ChangePage> {
  const payload = await readJson(await fetch("/api/v1/changes/list", {
    method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request), signal,
  }));
  const result = payload as unknown as ChangePage;
  if (!Array.isArray(result.items) || !Array.isArray(result.unknownTime) || !result.availability ||
      ![result.returnedNewCount, result.hiddenCount, result.unknownHiddenCount, result.watermark].every((v) => Number.isSafeInteger(v) && v >= 0) ||
      result.items.length + result.hiddenCount !== result.returnedNewCount ||
      !(result.nextBefore === null || (Number.isSafeInteger(result.nextBefore) && result.nextBefore > 0)) ||
      result.items.some((row) => !row.issuedAt || !Number.isFinite(Date.parse(row.issuedAt)))) {
    throw new Error("Turnover response is invalid");
  }
  return result;
}
export function useChanges(request: ChangeRequest, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: ["watchdesk-changes", request],
    initialPageParam: null as { before: number; watermark: number } | null,
    queryFn: ({ pageParam, signal }) => readChanges({ ...request, ...(pageParam ?? {}) }, signal),
    getNextPageParam: (last) => last.nextBefore === null ? undefined : { before: last.nextBefore, watermark: last.watermark },
    enabled, retry: false, staleTime: 15_000, gcTime: 60_000,
  });
}
