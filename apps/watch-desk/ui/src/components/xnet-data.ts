import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSettings } from "./settings-data";
import { readJson } from "./source-data";
import { sessionFetch } from "./session-access";
import { commandName, useCommands } from "./command-roster";

export type DeskNetwork = "LOW" | "HIGH" | "ALL";
export interface XnetNotice {
  id: string;
  version: number;
  payload: {
    shipId: string;
    count: number;
    highestPrecedence: "FLASH" | "IMMEDIATE" | "PRIORITY" | "ROUTINE" | "not stated";
    firstWaitingAt: string;
    latestWaitingAt: string;
  };
  sentAt: string;
  clearedAt: string | null;
  acknowledgedAt: string | null;
  unread: boolean;
}
export interface XnetMessageNotice {
  shipId: string;
  sentAt: string;
  clearedAt: string | null;
  version: number;
  acknowledgements: { username: string; at: string; version: number }[];
}
export async function xnetRequest<T>(operation: string, body: object = {}, signal?: AbortSignal): Promise<T> {
  const response = await sessionFetch(`/api/v1/xnet/${operation}`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  return (await readJson(response)) as unknown as T;
}
export function useDeskNetwork(): DeskNetwork {
  return useSettings().deskNetwork ?? "ALL";
}
export function useXnetNotices() {
  const desk = useDeskNetwork();
  return useQuery({
    queryKey: ["xnet", desk, "list"],
    queryFn: ({ signal }) => xnetRequest<{ items: XnetNotice[] }>("list", {}, signal),
    enabled: desk !== "HIGH",
    staleTime: 5000,
    gcTime: 60_000,
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
    retry: false,
  });
}
export function useAcknowledgeXnet() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (notice: XnetNotice) => xnetRequest("acknowledge", {
      shipId: notice.payload.shipId, id: notice.id, version: notice.version,
    }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["xnet"] }),
  });
}
export function xnetTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "time unavailable";
  return date.toISOString().slice(11, 16).replace(":", "") + "Z";
}
/** Roster display name for a ship ID when the app's command list knows it, else the raw ID. */
export function useShipName(): (shipId: string) => string {
  const roster = useCommands();
  const commands = roster.isError ? [] : roster.data?.commands ?? [];
  return (shipId) => commandName(`unit:${shipId}`, commands);
}
export function xnetTitle(notice: XnetNotice, shipName: string = notice.payload.shipId): string {
  const { count, highestPrecedence, firstWaitingAt } = notice.payload;
  return `Traffic waiting on HIGH (fictional) for ${shipName} · ${count} ${count === 1 ? "message" : "messages"} · ${highestPrecedence} · since ${xnetTime(firstWaitingAt)}`;
}
