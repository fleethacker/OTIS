import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useIdentity } from "../hooks/useIdentity";
import { readJson } from "./source-data";

export type ContextField = "ownShipId" | "shipName" | "operationName" | "groupCommand" | "defaultShips" | "turnoverUtc";
export interface WatchContext {
  ownShipId: string;
  shipName: string;
  operationName: string;
  groupCommand: string;
  defaultShips: string[];
  turnoverUtc: string[];
}
export interface ContextCitation {
  messageKey: string;
  auditId: string;
  setId: string;
  recordedAt: string;
  startByte: number;
  endByte: number;
  lineStart: number;
  lineEnd: number;
}
export interface ContextSuggestion {
  id: string;
  field: "operationName";
  values: string[];
  sources?: ContextCitation[];
}
export interface ContextResponse {
  context: WatchContext;
  confirmations: Partial<Record<ContextField, { actor: string; recordedAt: string; sources?: ContextCitation[]; confirmedHideUnassigned: boolean }>>;
  updatedBy: string | null;
  updatedAt: string | null;
  canEdit: boolean;
  suggestions: ContextSuggestion[];
  suggestionState: "available" | "unavailable" | "not_requested";
  suggestionsLimited: boolean;
  suggestionScope: string;
  defaultsSource: string;
}
export interface ContextUpdate {
  field?: ContextField;
  values?: string[];
  suggestionId?: string;
  dismiss?: boolean;
  confirmHideUnassigned?: boolean;
}
export async function contextRequest(operation: "get" | "update", body: ContextUpdate | { includeSuggestions?: boolean }, signal?: AbortSignal): Promise<ContextResponse> {
  const payload = await readJson(await fetch(`/api/v1/watch-context/${operation}`, {
    method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body), signal,
  }));
  const value = payload as unknown as ContextResponse;
  if (!value.context || typeof value.canEdit !== "boolean" || !value.confirmations ||
      ![value.context.ownShipId, value.context.shipName, value.context.operationName, value.context.groupCommand].every((v) => typeof v === "string") ||
      !Array.isArray(value.context.defaultShips) || !Array.isArray(value.context.turnoverUtc) || !Array.isArray(value.suggestions)) {
    throw new Error("Watch context response is invalid");
  }
  return value;
}
export function useWatchContext(suggestions = false) {
  const identity = useIdentity();
  const identityKey = JSON.stringify([identity.username, identity.email, identity.role]);
  const query = useQuery({
    queryKey: ["watchdesk-context", identityKey, suggestions],
    queryFn: ({ signal }) => contextRequest("get", { includeSuggestions: suggestions }, signal),
    enabled: !identity.isLoading && !!identity.username,
    staleTime: 15_000, gcTime: 60_000, retry: false,
    refetchInterval: suggestions ? false : 30_000,
    refetchOnWindowFocus: !suggestions,
  });
  return { ...query, identityKey, canEdit: identity.role === "platform_admin" && query.data?.canEdit === true };
}
export function useUpdateContext() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (request: ContextUpdate) => contextRequest("update", request),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ["watchdesk-context"] }),
        client.invalidateQueries({ queryKey: ["watchdesk-commands"] }),
      ]);
    },
  });
}
