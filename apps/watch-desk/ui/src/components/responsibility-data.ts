import { useQuery } from "@tanstack/react-query";
import { accountRequest, useSession } from "./session";

export interface ResponsibilityProfile {
  id: string;
  name: string;
  kind: "department" | "watch_role";
  messageTypes: string[];
}
export interface ResponsibilityCatalog {
  items: ResponsibilityProfile[];
  messageTypes: string[];
  messageTypesLimited?: boolean;
  observedTypesAvailable?: boolean;
}
export const responsibilityQueryKey = ["briefing-responsibilities"] as const;
function stringList(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string" && item.trim() !== "")
  );
}
function isResponsibility(value: unknown): value is ResponsibilityProfile {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === "string" &&
    item.id !== "" &&
    typeof item.name === "string" &&
    item.name.trim() !== "" &&
    (item.kind === "department" || item.kind === "watch_role") &&
    stringList(item.messageTypes)
  );
}
export async function readResponsibilities(signal?: AbortSignal): Promise<ResponsibilityCatalog> {
  const value = await accountRequest<unknown>("/api/v1/briefing/responsibilities", { signal });
  if (
    value === null ||
    typeof value !== "object" ||
    !("items" in value) ||
    !("messageTypes" in value) ||
    !Array.isArray(value.items) ||
    !value.items.every(isResponsibility) ||
    !stringList(value.messageTypes) ||
    new Set(value.items.map((item) => item.id)).size !== value.items.length
  ) {
    throw new Error("Department and watch profiles could not be loaded.");
  }
  const catalog = value as ResponsibilityCatalog;
  if (
    (catalog.messageTypesLimited !== undefined &&
      typeof catalog.messageTypesLimited !== "boolean") ||
    (catalog.observedTypesAvailable !== undefined &&
      typeof catalog.observedTypesAvailable !== "boolean")
  ) {
    throw new Error("Message category availability could not be verified.");
  }
  return catalog;
}
export function useResponsibilities(enabled = true) {
  const { session } = useSession();
  return useQuery({
    queryKey: [...responsibilityQueryKey, session?.user?.id],
    queryFn: ({ signal }) => readResponsibilities(signal),
    enabled,
    retry: false,
    staleTime: 30_000,
  });
}
