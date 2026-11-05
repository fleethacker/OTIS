import { useQuery } from "@tanstack/react-query";
import { accountRequest, useSession } from "./workflow-session";
import { isSourceObject, sourceScopeKey } from "./source-data";

export interface PlanningInterval {
  start: string;
  end: string;
}
export interface PlanningEvent {
  id: string;
  title: string;
  interval: PlanningInterval | null;
  personIds: string[];
  requiredQualifications: string[] | null;
  fixed: boolean;
  sourceRef: string;
  version: string;
  validated: boolean;
  bufferBeforeMinutes: number | null;
  bufferAfterMinutes: number | null;
}
export interface PlanningInputs {
  people: {
    id: string;
    name: string;
    qualifications: string[] | null;
    availability: PlanningInterval[] | null;
  }[];
  events: PlanningEvent[];
  rules: {
    eventId: string;
    window: PlanningInterval;
    earliestStart: string;
    durationMinutes: number;
    gridMinutes: number;
  };
  rosterObservedAt: string;
  rosterValidUntil: string;
  assessedAt: string;
  scheduleComplete: boolean;
  coverage: PlanningInterval;
}
export interface PlanningAssessment {
  status: "clear" | "feasible" | "no_feasible_slot" | "incomplete";
  provisional: boolean;
  collisions: {
    personId: string;
    eventIds: [string, string];
    overlap: PlanningInterval;
    includesBuffer: boolean;
  }[];
  alternative: PlanningInterval | null;
  explanation: string[];
  checkedStarts: number;
}
export interface PlanningProposal {
  id: string;
  inputVersion: string;
  status: "pending" | "accepted" | "rejected";
  alternative: PlanningInterval;
  createdAt: string;
  actor: string;
}
export interface PlanningDecision {
  proposalId: string;
  decision: "accept" | "reject";
  actor: string;
  recordedAt: string;
  inputVersion: string;
  reason: string;
}
export interface PlanningView {
  configured: boolean;
  canCoordinate: boolean;
  version: number;
  inputVersion: string | null;
  scenarioNow: string;
  inputs: PlanningInputs | null;
  assessment: PlanningAssessment | null;
  proposals: PlanningProposal[];
  decisions: PlanningDecision[];
}
export const planningQueryKey = ["pb4t"] as const;
function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}
function count(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}
function isInterval(value: unknown): value is PlanningInterval {
  return isSourceObject(value) && typeof value.start === "string" && typeof value.end === "string";
}
function isInputs(value: unknown): value is PlanningInputs {
  if (!isSourceObject(value) || !isSourceObject(value.rules)) {
    return false;
  }
  return (
    Array.isArray(value.people) &&
    value.people.every(
      (person) =>
        isSourceObject(person) &&
        typeof person.id === "string" &&
        typeof person.name === "string" &&
        (person.qualifications === null || strings(person.qualifications)) &&
        (person.availability === null ||
          (Array.isArray(person.availability) && person.availability.every(isInterval)))
    ) &&
    Array.isArray(value.events) &&
    value.events.every(
      (event) =>
        isSourceObject(event) &&
        typeof event.id === "string" &&
        typeof event.title === "string" &&
        (event.interval === null || isInterval(event.interval)) &&
        strings(event.personIds) &&
        (event.requiredQualifications === null || strings(event.requiredQualifications)) &&
        typeof event.fixed === "boolean" &&
        typeof event.sourceRef === "string" &&
        typeof event.version === "string" &&
        typeof event.validated === "boolean" &&
        (event.bufferBeforeMinutes === null || count(event.bufferBeforeMinutes)) &&
        (event.bufferAfterMinutes === null || count(event.bufferAfterMinutes))
    ) &&
    typeof value.rules.eventId === "string" &&
    isInterval(value.rules.window) &&
    typeof value.rules.earliestStart === "string" &&
    count(value.rules.durationMinutes) &&
    count(value.rules.gridMinutes) &&
    typeof value.rosterObservedAt === "string" &&
    typeof value.rosterValidUntil === "string" &&
    typeof value.assessedAt === "string" &&
    typeof value.scheduleComplete === "boolean" &&
    isInterval(value.coverage)
  );
}
function isAssessment(value: unknown): value is PlanningAssessment {
  return (
    isSourceObject(value) &&
    ["clear", "feasible", "no_feasible_slot", "incomplete"].includes(String(value.status)) &&
    typeof value.provisional === "boolean" &&
    Array.isArray(value.collisions) &&
    value.collisions.every(
      (collision) =>
        isSourceObject(collision) &&
        typeof collision.personId === "string" &&
        strings(collision.eventIds) &&
        collision.eventIds.length === 2 &&
        isInterval(collision.overlap) &&
        typeof collision.includesBuffer === "boolean"
    ) &&
    (value.alternative === null || isInterval(value.alternative)) &&
    strings(value.explanation) &&
    count(value.checkedStarts)
  );
}
export function isPlanningView(value: unknown): value is PlanningView {
  if (!isSourceObject(value)) {
    return false;
  }
  return (
    typeof value.configured === "boolean" &&
    typeof value.canCoordinate === "boolean" &&
    count(value.version) &&
    typeof value.scenarioNow === "string" &&
    (value.configured
      ? typeof value.inputVersion === "string" &&
        isInputs(value.inputs) &&
        isAssessment(value.assessment)
      : value.inputVersion === null && value.inputs === null && value.assessment === null) &&
    Array.isArray(value.proposals) &&
    value.proposals.every(
      (proposal) =>
        isSourceObject(proposal) &&
        typeof proposal.id === "string" &&
        typeof proposal.inputVersion === "string" &&
        ["pending", "accepted", "rejected"].includes(String(proposal.status)) &&
        isInterval(proposal.alternative) &&
        typeof proposal.createdAt === "string" &&
        typeof proposal.actor === "string"
    ) &&
    Array.isArray(value.decisions) &&
    value.decisions.every(
      (decision) =>
        isSourceObject(decision) &&
        typeof decision.proposalId === "string" &&
        ["accept", "reject"].includes(String(decision.decision)) &&
        typeof decision.actor === "string" &&
        typeof decision.recordedAt === "string" &&
        typeof decision.inputVersion === "string" &&
        typeof decision.reason === "string"
    )
  );
}
async function readPlanning(signal: AbortSignal): Promise<PlanningView> {
  const value = await accountRequest<unknown>("/api/v1/planning/read", {
    method: "POST",
    body: "{}",
    signal,
  });
  if (!isPlanningView(value)) {
    throw new Error("Personnel planning response could not be verified. Refresh to try again.");
  }
  return value;
}

export function usePlanning(enabled = true) {
  const { session } = useSession();
  return useQuery({
    queryKey: [...planningQueryKey, session?.user?.id, sourceScopeKey(session)],
    enabled:
      enabled && session?.authenticated === true && session.permissions.includes("schedule:read"),
    queryFn: ({ signal }) => readPlanning(signal),
    retry: false,
    staleTime: 15_000,
    gcTime: 60_000,
    refetchInterval:
      session?.settings.calendarRefreshSeconds === 0
        ? false
        : (session?.settings.calendarRefreshSeconds ?? 30) * 1000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
  });
}
