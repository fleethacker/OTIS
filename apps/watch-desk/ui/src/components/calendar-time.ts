import type { Timestamp } from "@bufbuild/protobuf/wkt";
import type { ExtractedEvent } from "../gen/app/v1/models_pb";
import moment from "moment-timezone";

export const HOUR = 3_600_000;
export type CalendarView = "day" | "week" | "month";
export function weekBounds(date: string, zone = "UTC") {
  // Same Moment locale week convention consumed by calendarLocalizer.firstOfWeek.
  const start = moment.tz(date, "YYYY-MM-DD", zone).startOf("week");
  return { from: +start, to: +start.clone().add(1, "week") };
}
export function monthBounds(date: string, zone = "UTC") {
  const start = moment.tz(`${date.slice(0, 7)}-01`, "YYYY-MM-DD", zone);
  const end = start.clone().add(1, "month");
  return {
    from: +start,
    to: +end,
    days: start.daysInMonth(),
  };
}
export function moveMonth(date: string, delta: number) {
  const start = new Date(monthBounds(date).from);
  start.setUTCMonth(start.getUTCMonth() + delta);
  return start.toISOString().slice(0, 10);
}
export function instant(t?: Timestamp): number {
  return t ? Number(t.seconds) * 1000 + t.nanos / 1_000_000 : NaN;
}
export function geometry(event: ExtractedEvent, from: number, to: number) {
  const start = instant(event.startAt),
    end = instant(event.endAt);
  if (
    event.scheduleStatus !== "confirmed" ||
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    end <= start ||
    start >= to ||
    end <= from ||
    to <= from
  ) {
    return null;
  }
  return {
    left: (100 * (Math.max(start, from) - from)) / (to - from),
    width: (100 * (Math.min(end, to) - Math.max(start, from))) / (to - from),
    before: start < from,
    after: end > to,
  };
}
export function utcDate(value: string | null, fallback: string): string {
  if (value === null || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return fallback;
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
    ? value
    : fallback;
}
