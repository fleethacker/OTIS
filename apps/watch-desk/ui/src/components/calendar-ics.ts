import type { MessageRecord } from "../gen/app/v1/models_pb";
import type { Command } from "./command-roster";
import type { Dataset, SourceMeta } from "./source-data";
import { messageHref } from "./calendar-links";
import { shipKey, shipName, UNASSIGNED } from "./ship-calendars";

const DAY = 86_400_000;
const HALF_HOUR = 30 * 60_000;

export interface IcsShip { key: string; name: string }
export interface CalendarIcsEvent {
  messageKey: string;
  factId: string;
  title: string;
  eventType: string;
  ships: IcsShip[];
  messageTitle: string;
  sentDtg?: string;
  kind: "point" | "interval" | "unresolved";
  start?: string;
  end?: string;
  /** Only for a series master with a known DTSTART, never an expanded occurrence. */
  recurrenceRule?: string;
}
export interface TimedIcsEvent extends CalendarIcsEvent {
  startMs: number;
  endMs: number;
}
export interface IcsFilter {
  ships?: ReadonlySet<string>;
  types?: ReadonlySet<string>;
  from: number;
  to: number;
}

/** Inclusive UTC dates, bounded to the existing timeline API's 42-day window. */
export function calendarExportRange(first: string, last: string) {
  function day(value: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
    const ms = Date.parse(`${value}T00:00:00Z`);
    return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value ? ms : NaN;
  }
  const from = day(first), to = day(last) + DAY;
  return Number.isFinite(from) && Number.isFinite(to) && to > from && to - from <= 42 * DAY
    ? { from, to } : undefined;
}

export function calendarExportEnd(date: string) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + 7 * DAY).toISOString().slice(0, 10);
}

/** Use titles as the source's event types; sourceType is the message type, not the event type. */
export function calendarIcsEvents(
  messages: readonly MessageRecord[], meta: SourceMeta, commands: readonly Command[], dataset: Dataset
): CalendarIcsEvent[] {
  const parents = new Map(messages.map((message) => [message.sourceMessageId, message]));
  const names = new Map(commands.map((command) => [`unit:${command.id}`, command.name]));
  const ship = (key: string): IcsShip => ({ key, name: key === UNASSIGNED
    ? "Unassigned / needs applicability review" : names.get(key) ?? key.slice(5) });
  const source = (messageKey: string) => ({
    messageKey,
    messageTitle: parents.get(messageKey)?.subject?.trim() || "Untitled message",
    sentDtg: meta.messageHeaders?.[messageKey]?.issuedAt,
  });
  if (dataset === "legacy") {
    return messages.flatMap((message) => message.events.map((event) => {
      const title = event.title.trim() || "Untitled event";
      const timestamp = (value: typeof event.startAt) => {
        if (!value) return undefined;
        const ms = Number(value.seconds) * 1000 + value.nanos / 1_000_000;
        return Number.isFinite(ms) && !Number.isNaN(new Date(ms).getTime()) ? new Date(ms).toISOString() : undefined;
      };
      return {
        ...source(message.sourceMessageId), factId: event.sourceEventId || String(event.id),
        title, eventType: title, ships: [{ key: shipKey(event.unit), name: shipName(event.unit) }],
        kind: "interval" as const, start: timestamp(event.startAt), end: timestamp(event.endAt),
      };
    }));
  }
  // Canonical timeline items are authoritative. Protobuf activities can also contain
  // unresolved prototypes represented by recurrence occurrences: do not export both.
  return [...(meta.timelineItems ?? []), ...(meta.reviewItems ?? [])].map((item) => {
    const title = item.title.trim() || "Untitled event";
    const keys = item.commandIds?.length ? [...new Set(item.commandIds)].map((id) => `unit:${id}`) : [UNASSIGNED];
    return {
      ...source(item.messageKey), factId: item.factId || item.key,
      title, eventType: title, ships: keys.map(ship), kind: item.kind,
      start: item.kind === "point" ? item.at : item.start, end: item.end,
      // The API supplies bounded occurrences, not the series DTSTART/bounds.
      // Keep their occurrence fact IDs and deliberately omit RRULE.
    };
  });
}

function instant(value?: string) {
  // An unzoned clock or date must never be interpreted using the browser's timezone.
  return value && /(?:Z|[+-]\d{2}:\d{2})$/i.test(value) ? Date.parse(value) : NaN;
}

export function filterCalendarIcsEvents(events: readonly CalendarIcsEvent[], filter: IcsFilter) {
  const included: TimedIcsEvent[] = [];
  const seen = new Set<string>();
  let skippedUntimed = 0;
  for (const event of events) {
    const identity = JSON.stringify([event.messageKey, event.factId]);
    if (seen.has(identity)) continue;
    seen.add(identity);
    const selectedShips = filter.ships;
    if (selectedShips && !event.ships.some((ship) => selectedShips.has(ship.key))) continue;
    if (filter.types && !filter.types.has(event.eventType)) continue;
    const startMs = instant(event.start);
    const endMs = event.kind === "point" && !event.end ? startMs + HALF_HOUR : instant(event.end);
    if (event.kind === "unresolved" || !Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
      skippedUntimed++;
      continue;
    }
    // Match timeline semantics: points start in the window; intervals overlap it.
    // Preserve the real event bounds rather than clipping DTSTART/DTEND.
    if (startMs >= filter.to || (event.kind === "point" ? startMs < filter.from : endMs <= filter.from)) continue;
    included.push({ ...event, startMs, endMs });
  }
  included.sort((a, b) => a.startMs - b.startMs || a.messageKey.localeCompare(b.messageKey) || a.factId.localeCompare(b.factId));
  return { events: included, messageCount: new Set(included.map((event) => event.messageKey)).size, skippedUntimed };
}

export function escapeIcsText(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/\r\n|\r|\n/g, "\\n").replace(/;/g, "\\;").replace(/,/g, "\\,");
}

/** RFC 5545 folding counts UTF-8 octets, including the continuation space. */
export function foldIcsLine(line: string) {
  const encoder = new TextEncoder();
  let result = "", width = 0;
  for (const character of line) {
    const size = encoder.encode(character).length;
    if (width + size > 75) { result += "\r\n "; width = 1; }
    result += character;
    width += size;
  }
  return result;
}

export function formatIcsUtc(value: number | Date) {
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export function calendarIcsUid(event: Pick<CalendarIcsEvent, "messageKey" | "factId">) {
  // Encoding each component separately preserves boundaries, even for arbitrary source IDs.
  return `${encodeURIComponent(event.messageKey)}#${encodeURIComponent(event.factId)}@otis.local`;
}

export function generateCalendarIcs(
  events: readonly TimedIcsEvent[], options: { now: Date; origin: string; returnTo: string }
) {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//OTIS//Calendar Export//EN", "CALSCALE:GREGORIAN"];
  for (const event of events) {
    const description = [
      `Source message: ${event.messageTitle}`,
      ...(event.sentDtg ? [`Sent DTG: ${event.sentDtg}`] : []),
      `${options.origin}${messageHref(event.messageKey, options.returnTo)}`,
      "UNCLASSIFIED // FICTIONAL DEMO DATA",
    ].join("\n");
    lines.push("BEGIN:VEVENT", `UID:${calendarIcsUid(event)}`, `DTSTAMP:${formatIcsUtc(options.now)}`,
      `DTSTART:${formatIcsUtc(event.startMs)}`, `DTEND:${formatIcsUtc(event.endMs)}`);
    if (event.recurrenceRule) {
      // RRULE is structured syntax, not TEXT. Reject content-line injection.
      if (!/^[A-Z0-9=;,+-]+$/.test(event.recurrenceRule)) throw new Error("Invalid recurrence rule");
      lines.push(`RRULE:${event.recurrenceRule}`);
    }
    lines.push(
      `SUMMARY:${escapeIcsText(`${event.title} · ${event.ships.map((ship) => ship.name).join(", ")}`)}`,
      `CATEGORIES:${[...new Set([...event.ships.map((ship) => ship.name), event.eventType])].map(escapeIcsText).join(",")}`,
      `DESCRIPTION:${escapeIcsText(description)}`, "END:VEVENT"
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldIcsLine).join("\r\n") + "\r\n";
}
