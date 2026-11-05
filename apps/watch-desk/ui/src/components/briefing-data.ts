import { useQuery } from "@tanstack/react-query";
import { sourceScopeKey } from "./source-data";
import {
  accountRequest,
  defaultMessageScope,
  isMessageScope,
  isTimestamp,
  useSession,
  type MessageScope,
} from "./session";

export interface BriefingItem {
  messageKey: string;
  subject: string;
  type: string;
  originator: string;
  issuedAt: string | null;
  availableAt: string;
  commandIds: string[];
}
export interface BriefingPage {
  items: BriefingItem[];
  since: string | null;
  through: string;
  firstLogin: boolean;
  totalRecords: number;
  nextPageToken: string | null;
  previousPageToken: string | null;
  page: number;
  pageSize: number;
  messageScope?: MessageScope;
}
export function useBriefing(pageToken?: string) {
  const { session } = useSession();
  const scope = session?.settings.messageScope ?? defaultMessageScope;
  return useQuery({
    queryKey: [
      "shift-briefing",
      session?.user?.id,
      session?.login?.startedAt,
      scope,
      pageToken,
      sourceScopeKey(session),
    ],
    queryFn: async ({ signal }) => {
      const data = await accountRequest<unknown>("/api/v1/briefing", {
        method: "POST",
        body: JSON.stringify({ pageToken }),
        signal,
      });
      if (!isBriefingPage(data)) {
        throw new Error("The shift briefing could not be verified. Please retry.");
      }
      return data;
    },
    enabled: session?.login?.briefingAvailable === true,
    retry: false,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}
function isBriefingItem(value: unknown): value is BriefingItem {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const item = value as Record<string, unknown>;
  return (
    typeof item.messageKey === "string" &&
    item.messageKey !== "" &&
    typeof item.subject === "string" &&
    typeof item.type === "string" &&
    typeof item.originator === "string" &&
    (item.issuedAt === null || isTimestamp(item.issuedAt)) &&
    isTimestamp(item.availableAt) &&
    Array.isArray(item.commandIds) &&
    item.commandIds.every((id) => typeof id === "string" && id.trim() !== "")
  );
}
function isBriefingPage(value: unknown): value is BriefingPage {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const data = value as Record<string, unknown>;
  if (
    !Array.isArray(data.items) ||
    !data.items.every(isBriefingItem) ||
    !isTimestamp(data.through) ||
    typeof data.firstLogin !== "boolean" ||
    (data.firstLogin ? data.since !== null : !isTimestamp(data.since)) ||
    typeof data.totalRecords !== "number" ||
    !Number.isSafeInteger(data.totalRecords) ||
    data.totalRecords < 0 ||
    typeof data.page !== "number" ||
    !Number.isSafeInteger(data.page) ||
    data.page < 1 ||
    typeof data.pageSize !== "number" ||
    !Number.isSafeInteger(data.pageSize) ||
    data.pageSize < 1
  ) {
    return false;
  }
  return (
    (data.since === null ||
      (isTimestamp(data.since) && Date.parse(data.since) <= Date.parse(data.through))) &&
    data.items.length <= data.pageSize &&
    data.items.length <= data.totalRecords &&
    data.page <= Math.max(1, Math.ceil(data.totalRecords / data.pageSize)) &&
    new Set(data.items.map((item) => item.messageKey)).size === data.items.length &&
    [data.nextPageToken, data.previousPageToken].every(
      (token) => token === null || (typeof token === "string" && token !== "")
    ) &&
    (data.messageScope === undefined || isMessageScope(data.messageScope))
  );
}
export function briefingScopeLabel(scope: MessageScope) {
  const assigned = scope.allCommands ? "All assigned commands" : scope.commandIds.join(", ");
  if (scope.includeUnassigned) {
    return assigned === ""
      ? "Unassigned traffic only"
      : `${assigned} · Unassigned traffic included`;
  }
  return assigned === ""
    ? "No commands selected; unassigned traffic excluded"
    : `${assigned} · Unassigned traffic excluded`;
}
export function shiftReturn(value: string | null) {
  if (value === null || !value.startsWith("/")) {
    return "/calendar";
  }
  try {
    const url = new URL(value, "https://watch.invalid");
    if (
      url.origin === "https://watch.invalid" &&
      ["/calendar", "/messages", "/account", "/users", "/settings", "/watch-settings"].includes(
        url.pathname
      )
    ) {
      return url.pathname + url.search + url.hash;
    }
  } catch {
    /* Unknown destinations return to the calendar. */
  }
  return "/calendar";
}
