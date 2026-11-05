import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { readJson } from "./source-data";
import { sessionFetch } from "./session-access";

export interface DeskNotification {
  id: number;
  version: number;
  kind: "traffic" | "failed" | "recovered";
  context: string;
  messageKey: string;
  at: string;
  detail: string;
  resolvedAt: string | null;
  count: number;
  unread: boolean;
}
export interface NotificationMember {
  messageKey: string;
  subject: string;
  context: string;
  at: string;
  version: number;
}
export interface NotificationPage {
  items: DeskNotification[];
  unread: number;
  watermark: number;
  nextBefore: number | null;
  catchingUp: boolean;
}
interface MemberPage {
  items: NotificationMember[];
  nextBefore: number | null;
}
export async function notificationRequest<T>(
  operation: string,
  body: object,
  signal?: AbortSignal
) {
  const response = await sessionFetch(`/api/v1/notifications/${operation}`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  return (await readJson(response)) as unknown as T;
}
export function useNotifications(identity: string) {
  return useInfiniteQuery({
    queryKey: ["notifications", identity, "list"],
    initialPageParam: null as number | null,
    queryFn: ({ pageParam, signal }) =>
      notificationRequest<NotificationPage>("list", { before: pageParam }, signal),
    getNextPageParam: (last) => last.nextBefore ?? undefined,
    staleTime: 10_000,
    gcTime: 60_000,
    retry: false,
    refetchInterval: (query) => (query.state.data?.pages[0]?.catchingUp === true ? 1000 : 30_000),
    refetchIntervalInBackground: false,
  });
}
export function useNotificationMembers(identity: string, id?: number) {
  return useInfiniteQuery({
    queryKey: ["notifications", identity, "members", id],
    initialPageParam: null as number | null,
    queryFn: ({ pageParam, signal }) =>
      notificationRequest<MemberPage>("members", { id, before: pageParam }, signal),
    getNextPageParam: (last) => last.nextBefore ?? undefined,
    enabled: id !== undefined,
    staleTime: 10_000,
    gcTime: 60_000,
    retry: false,
  });
}
export function useReadNotification(identity: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (selection: { id: number; version: number } | { through: number }) =>
      notificationRequest("read", selection),
    onSuccess: () => client.invalidateQueries({ queryKey: ["notifications", identity] }),
  });
}
export function notificationTitle(item: DeskNotification): string {
  if (item.kind === "failed") {
    return "Message ingestion failed";
  }
  if (item.kind === "recovered") {
    return "Message ingestion recovered";
  }
  return item.count === 1 ? "New message received" : `${item.count} new messages received`;
}
export function notificationTime(value: string, zone = "UTC"): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return "Time unavailable";
  }
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("day")} ${get("month").toUpperCase()} ${get("year")} ${get("hour")}${get("minute")}${zone === "UTC" ? "Z" : ` ${zone}`}`;
}

export function notificationItems(pages: NotificationPage[] = []): DeskNotification[] {
  const result = new Map<number, DeskNotification>();
  for (const page of pages) {
    for (const item of page.items) {
      const previous = result.get(item.id);
      if (previous === undefined || item.version > previous.version) {
        result.set(item.id, item);
      }
    }
  }
  return [...result.values()].sort((a, b) => b.version - a.version);
}
