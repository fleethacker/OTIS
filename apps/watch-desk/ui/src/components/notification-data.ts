import type { MessageRecord } from "../gen/app/v1/models_pb";
import { instant } from "./calendar-time";

export interface DeskNotification {
  key: string;
  type: "Daily reminder" | "Action item";
  title: string;
  context: string;
  message?: string;
  fictional?: boolean;
}
export const utcDay = () => new Date().toISOString().slice(0, 10);

// Canonicalize relevant content, not response time or source ordering.
function canonical(value: unknown): string {
  if (typeof value === "bigint") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonical).sort().join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .filter(([k]) => k !== "$typeName")
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}:${canonical(v)}`)
      .join(",")}}`;
  }
  return value === undefined ? "" : JSON.stringify(value);
}
export function notifications(messages: MessageRecord[], day: string): DeskNotification[] {
  const items: DeskNotification[] = [
    {
      key: `daily:${day}`,
      type: "Daily reminder",
      title: "Review today's UTC schedule",
      context: `${day} · Calendar`,
    },
  ];
  for (const m of messages) {
    const reasons: string[] = [];
    const relevant = m.events.filter((e) => {
      const start = instant(e.startAt),
        end = instant(e.endAt);
      const unresolved =
        e.scheduleStatus !== "confirmed" ||
        !Number.isFinite(start) ||
        !Number.isFinite(end) ||
        end <= start;
      if (e.isRevised || e.revisions.length > 0) {
        reasons.push(`${e.title}: Revised schedule — review changes`);
      }
      if (unresolved) {
        reasons.push(`${e.title}: Needs review — ${e.reviewReason ?? "schedule times unresolved"}`);
      }
      return unresolved || e.isRevised || e.revisions.length > 0;
    });
    if (m.processingStatus === "needs_review") {
      reasons.push("Message record needs review");
    }
    if (reasons.length === 0) {
      continue;
    }
    items.push({
      key: `source:${m.sourceMessageId}:${canonical({ status: m.processingStatus, events: relevant })}`,
      type: "Action item",
      title: m.subject ?? m.sourceMessageId,
      context: [...new Set(reasons)].sort().join("; "),
      message: m.sourceMessageId,
      fictional: m.provenance === "fictional",
    });
  }
  return [...new Map(items.map((item) => [item.key, item])).values()];
}

export function readNotificationState(identity: string): { keys: string[]; failed: boolean } {
  try {
    const raw = localStorage.getItem(`watch-desk:notifications:v1:${identity}`);
    const value: unknown = raw !== null ? JSON.parse(raw) : [];
    if (!Array.isArray(value) || !value.every((k) => typeof k === "string")) {
      return { keys: [], failed: true };
    }
    return { keys: value, failed: false };
  } catch {
    return { keys: [], failed: true };
  }
}
export function saveNotificationState(identity: string, keys: string[]): boolean {
  try {
    localStorage.setItem(`watch-desk:notifications:v1:${identity}`, JSON.stringify(keys));
    return true;
  } catch {
    return false;
  }
}
