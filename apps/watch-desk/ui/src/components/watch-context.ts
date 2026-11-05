import { sessionFetch } from "./session-access";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useIdentity } from "../hooks/useIdentity";
import { readJson, sourceScopeKey, SourceError, isSourceObject } from "./source-data";

import { useSession } from "./session";

export type ContextField =
  | "ownShipId"
  | "shipName"
  | "operationName"
  | "groupCommand"
  | "defaultShips"
  | "turnoverUtc";
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
  confirmations: Partial<
    Record<
      ContextField,
      {
        actor: string;
        recordedAt: string;
        sources?: ContextCitation[];
        confirmedHideUnassigned: boolean;
      }
    >
  >;
  updatedBy: string | null;
  updatedAt: string | null;
  canEdit: boolean;
  suggestions: ContextSuggestion[];
  suggestionState: "available" | "unavailable" | "not_requested";
  suggestionsLimited: boolean;
  suggestionScope: string;
  defaultsSource: string;
  demoRoster?: boolean;
}
export interface ContextChange {
  field: ContextField;
  values: string[];
  confirmHideUnassigned?: boolean;
}
export interface ContextUpdate {
  changes?: ContextChange[];
  field?: ContextField;
  values?: string[];
  suggestionId?: string;
  dismiss?: boolean;
  confirmHideUnassigned?: boolean;
}
export async function contextRequest(
  operation: "get" | "update",
  body: ContextUpdate | { includeSuggestions?: boolean },
  signal?: AbortSignal
): Promise<ContextResponse> {
  const payload = await readJson(
    await sessionFetch(`/api/v1/watch-context/${operation}`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    })
  );
  const value = payload as unknown as ContextResponse;
  if (
    !isSourceObject(value.context) ||
    typeof value.canEdit !== "boolean" ||
    !isSourceObject(value.confirmations) ||
    ![
      value.context.ownShipId,
      value.context.shipName,
      value.context.operationName,
      value.context.groupCommand,
    ].every((v) => typeof v === "string") ||
    !Array.isArray(value.context.defaultShips) ||
    !Array.isArray(value.context.turnoverUtc) ||
    !Array.isArray(value.suggestions)
  ) {
    throw new Error("Watch context response is invalid");
  }
  return value;
}
export function useWatchContext(suggestions = false, enabled = true) {
  const identity = useIdentity();
  const { session } = useSession();
  const identityKey = JSON.stringify([
    identity.username,
    identity.email,
    identity.role,
    session?.user?.id,
    sourceScopeKey(session),
  ]);
  const query = useQuery({
    queryKey: ["watchdesk-context", identityKey, suggestions],
    queryFn: ({ signal }) => contextRequest("get", { includeSuggestions: suggestions }, signal),
    enabled: enabled && !identity.isLoading && !!identity.username,
    staleTime: 15_000,
    gcTime: 60_000,
    retry: false,
    refetchInterval: suggestions ? false : 30_000,
    refetchOnWindowFocus: !suggestions,
  });
  const denied =
    query.error instanceof SourceError &&
    ["permission_denied", "unauthenticated", "failed_precondition"].includes(query.error.code);
  return {
    ...query,
    data: denied ? undefined : query.data,
    identityKey,
    canEdit: !denied && identity.role === "admin" && query.data?.canEdit === true,
  };
}
export function useUpdateContext() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (request: ContextUpdate) => contextRequest("update", request),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ["watchdesk-context"] }),
        client.invalidateQueries({ queryKey: ["settings", "shared"] }),
        client.invalidateQueries({ queryKey: ["settings", "suggestions"] }),
        client.invalidateQueries({ queryKey: ["watchdesk-commands"] }),
      ]);
    },
  });
}
