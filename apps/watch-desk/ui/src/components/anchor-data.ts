import { useQuery } from "@tanstack/react-query";
import { useSession } from "./workflow-session";
import { sessionFetch } from "./session-access";
import { isSourceObject, readJson, sourceScopeKey } from "./source-data";

export interface AnchorSource {
  messageKey: string;
  contentHash: string;
  factId: string | null;
}
export interface AnchorVersion {
  id: string;
  source: AnchorSource;
  relationship: { kind: "original" } | { kind: "amends" | "cancels"; target: string };
  effectiveAt: string;
  interval: { start: string; end: string } | null;
  provenance: string;
  parsedReviewRequired: boolean;
}
export interface CurrentEventView {
  logicalEventId: string;
  status: "active" | "cancelled" | "pending" | "unresolved";
  versionToken: string | null;
  current: AnchorVersion | null;
  original: AnchorVersion | null;
  previous: AnchorVersion | null;
  history: AnchorVersion[];
  nextEffectiveAt: string | null;
  problems: string[];
  taskId: string | null;
  taskVersion: number | null;
  eventVersion: number | null;
  canReview: boolean;
  reviewed: boolean;
  reviews: {
    actor: string;
    responsibilityId: string;
    source: { messageKey: string; factId: string | null };
    eventVersion: number;
    recordedAt: string;
    currentVersionToken: string | null;
  }[];
}
export interface AnchorResponse {
  scenarioId: string;
  scenarioNow: string;
  version: number;
  configured: boolean;
  complete: boolean;
  coverage: string;
  items: CurrentEventView[];
}

function isVersion(value: unknown): value is AnchorVersion {
  if (
    !isSourceObject(value) ||
    !isSourceObject(value.source) ||
    !isSourceObject(value.relationship)
  ) {
    return false;
  }
  const relationship = value.relationship;
  return (
    typeof value.id === "string" &&
    typeof value.source.messageKey === "string" &&
    typeof value.source.contentHash === "string" &&
    (value.source.factId === null || typeof value.source.factId === "string") &&
    (relationship.kind === "original" ||
      (["amends", "cancels"].includes(String(relationship.kind)) &&
        typeof relationship.target === "string")) &&
    typeof value.effectiveAt === "string" &&
    (value.interval === null ||
      (isSourceObject(value.interval) &&
        typeof value.interval.start === "string" &&
        typeof value.interval.end === "string")) &&
    typeof value.provenance === "string" &&
    typeof value.parsedReviewRequired === "boolean"
  );
}
export function isCurrentEvent(value: unknown): value is CurrentEventView {
  if (!isSourceObject(value)) {
    return false;
  }
  return (
    typeof value.logicalEventId === "string" &&
    ["active", "cancelled", "pending", "unresolved"].includes(String(value.status)) &&
    (value.versionToken === null || typeof value.versionToken === "string") &&
    [value.current, value.original, value.previous].every(
      (version) => version === null || isVersion(version)
    ) &&
    Array.isArray(value.history) &&
    value.history.every(isVersion) &&
    (value.nextEffectiveAt === null || typeof value.nextEffectiveAt === "string") &&
    Array.isArray(value.problems) &&
    value.problems.every((problem) => typeof problem === "string") &&
    (value.taskId === null || typeof value.taskId === "string") &&
    [value.taskVersion, value.eventVersion].every(
      (version) => version === null || (Number.isSafeInteger(version) && Number(version) >= 0)
    ) &&
    typeof value.canReview === "boolean" &&
    typeof value.reviewed === "boolean" &&
    Array.isArray(value.reviews) &&
    value.reviews.every(
      (review) =>
        isSourceObject(review) &&
        typeof review.actor === "string" &&
        typeof review.responsibilityId === "string" &&
        typeof review.recordedAt === "string" &&
        Number.isSafeInteger(review.eventVersion) &&
        isSourceObject(review.source) &&
        typeof review.source.messageKey === "string" &&
        (review.source.factId === null || typeof review.source.factId === "string") &&
        (review.currentVersionToken === null || typeof review.currentVersionToken === "string")
    )
  );
}
export async function readAnchor(
  messageKey?: string,
  signal?: AbortSignal
): Promise<AnchorResponse> {
  const value = await readJson(
    await sessionFetch("/api/v1/anchor/current", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(messageKey === undefined ? {} : { messageKey }),
      signal,
    })
  );
  if (
    typeof value.scenarioId !== "string" ||
    typeof value.scenarioNow !== "string" ||
    !Number.isSafeInteger(value.version) ||
    typeof value.configured !== "boolean" ||
    typeof value.complete !== "boolean" ||
    typeof value.coverage !== "string" ||
    !Array.isArray(value.items) ||
    !value.items.every(isCurrentEvent)
  ) {
    throw new Error("Message history response could not be verified");
  }
  return value as unknown as AnchorResponse;
}
export function useAnchorCurrent(messageKey?: string) {
  const { session } = useSession();
  const result = useQuery({
    queryKey: [
      "anchor-current",
      messageKey ?? null,
      session?.user?.id ?? "anonymous",
      sourceScopeKey(session),
    ],
    queryFn: ({ signal }) => readAnchor(messageKey, signal),
    enabled:
      session?.authenticated === true &&
      messageKey !== "" &&
      messageKey?.startsWith("legacy:") !== true,
    retry: false,
    staleTime: 15_000,
    gcTime: 60_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
  });
  // A failed current read must never present cached instructions as current.
  return { ...result, data: result.isError ? undefined : result.data };
}
