import { isCurrentEvent, type CurrentEventView } from "./anchor-data";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { accountRequest, useSession } from "./workflow-session";
import { sourceScopeKey } from "./source-data";

export interface WorkSource {
  messageKey: string;
  factId: string | null;
}
export interface WorkTask {
  id: string;
  logicalEventId: string;
  version: number;
  eventVersion: number;
  source: WorkSource;
  currentVersionToken?: string | null;
  instructionStatus?: "active" | "cancelled" | "pending" | "unresolved";
  remindersActive?: boolean;
  currentEvent?: CurrentEventView;
  action: string;
  commandId: string;
  responsibilityId: string;
  responsibilityName: string;
  ownerId: string | null;
  ownerName: string | null;
  personId: string | null;
  ruleId: string;
  assignmentReason: string;
  dueAt: string | null;
  dueBasis: string;
  start: string | null;
  end: string | null;
  sourceExcerpt: string;
  sourceContacts: { name?: string; position?: string; unit?: string }[] | null;
  sourceStatus: string;
  factStatus: string;
  reviewFlags: string[];
  progress: "not_started" | "in_progress" | "completed";
  reviews: {
    actor: string;
    responsibilityId: string;
    source: WorkSource;
    eventVersion: number;
    recordedAt: string;
  }[];
  history: {
    actor: string;
    recordedAt: string;
    action: string;
    reason: string;
    before: unknown;
    after: unknown;
  }[];
  canAct: boolean;
  reviewed: boolean;
  overdue: boolean;
}
export interface WorkList {
  configured: boolean;
  canCoordinate: boolean;
  scenarioId: string;
  scenarioNow: string;
  version: number;
  pendingSources: string[];
  items: WorkTask[];
}
export function workRequest<T>(operation: string, body: object, signal?: AbortSignal) {
  return accountRequest<T>(`/api/v1/work/${operation}`, {
    method: "POST",
    body: JSON.stringify(body),
    signal,
  });
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function nullableText(value: unknown): boolean {
  return value === null || typeof value === "string";
}
function source(value: unknown): boolean {
  return record(value) && typeof value.messageKey === "string" && nullableText(value.factId);
}
function taskShape(value: unknown): boolean {
  if (!record(value)) {
    return false;
  }
  return (
    [
      "id",
      "logicalEventId",
      "action",
      "commandId",
      "responsibilityId",
      "responsibilityName",
      "ruleId",
      "assignmentReason",
      "dueBasis",
      "sourceExcerpt",
      "sourceStatus",
      "factStatus",
    ].every((key) => typeof value[key] === "string") &&
    ["ownerId", "ownerName", "personId", "dueAt", "start", "end"].every((key) =>
      nullableText(value[key])
    ) &&
    ["canAct", "reviewed", "overdue"].every((key) => typeof value[key] === "boolean") &&
    typeof value.version === "number" &&
    typeof value.eventVersion === "number" &&
    source(value.source) &&
    (value.currentEvent === undefined || isCurrentEvent(value.currentEvent)) &&
    typeof value.progress === "string" &&
    ["not_started", "in_progress", "completed"].includes(value.progress) &&
    Array.isArray(value.reviewFlags) &&
    value.reviewFlags.every((flag) => typeof flag === "string") &&
    (value.sourceContacts === null ||
      (Array.isArray(value.sourceContacts) &&
        value.sourceContacts.every(
          (contact) =>
            record(contact) &&
            ["name", "position", "unit"].every(
              (key) => contact[key] === undefined || typeof contact[key] === "string"
            )
        ))) &&
    Array.isArray(value.reviews) &&
    value.reviews.every(
      (review) =>
        record(review) &&
        source(review.source) &&
        typeof review.actor === "string" &&
        typeof review.eventVersion === "number" &&
        typeof review.recordedAt === "string"
    ) &&
    Array.isArray(value.history) &&
    value.history.every(
      (entry) =>
        record(entry) &&
        ["actor", "recordedAt", "action", "reason"].every((key) => typeof entry[key] === "string")
    )
  );
}
export function validateWorkList(value: unknown): WorkList {
  if (
    !record(value) ||
    typeof value.configured !== "boolean" ||
    typeof value.canCoordinate !== "boolean" ||
    typeof value.scenarioId !== "string" ||
    typeof value.scenarioNow !== "string" ||
    typeof value.version !== "number" ||
    !Array.isArray(value.pendingSources) ||
    !value.pendingSources.every((item) => typeof item === "string") ||
    !Array.isArray(value.items) ||
    !value.items.every(taskShape)
  ) {
    throw new Error("The server returned invalid work data. Refresh to try again.");
  }
  return value as unknown as WorkList;
}
export function useWork() {
  const { session } = useSession();
  return useQuery({
    queryKey: ["assigned-work", session?.user?.id, sourceScopeKey(session)],
    queryFn: ({ signal }) => workRequest<WorkList>("list", {}, signal).then(validateWorkList),
    enabled: session?.authenticated === true,
    retry: false,
    refetchInterval: 30_000,
  });
}
export function useWorkMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ operation, body }: { operation: string; body: object }) =>
      workRequest(operation, body),
    onSettled: () =>
      Promise.all(
        ["assigned-work", "anchor-current", "parse-command-source", "pb4t"].map((key) =>
          client.invalidateQueries({ queryKey: [key] })
        )
      ),
  });
}
