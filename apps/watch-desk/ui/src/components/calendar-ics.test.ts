import { expect, test } from "bun:test";
import { create } from "@bufbuild/protobuf";
import { MessageRecordSchema } from "../gen/app/v1/models_pb";
import type { TimelineItem } from "./source-data";
import {
  calendarExportEnd, calendarExportRange, calendarIcsEvents, calendarIcsUid,
  escapeIcsText, filterCalendarIcsEvents, foldIcsLine, formatIcsUtc, generateCalendarIcs,
  type CalendarIcsEvent,
} from "./calendar-ics";

const from = Date.parse("2026-11-05T00:00:00Z"), to = Date.parse("2026-11-13T00:00:00Z");
const ship = { key: "unit:demo-tern", name: "USNS Tern" };
const base: CalendarIcsEvent = {
  messageKey: "fictional-message@r1", factId: "a1", title: "communications check", eventType: "communications check",
  ships: [ship], messageTitle: "Fictional tasking", kind: "point", start: "2026-11-05T08:00:00Z",
};
const options = { now: new Date("2026-11-04T20:01:02.345Z"), origin: "https://otis.example", returnTo: "/calendar?date=2026-11-05" };
function generate(events: CalendarIcsEvent[]) {
  return generateCalendarIcs(filterCalendarIcsEvents(events, { from, to }).events, options);
}
function unfold(value: string) { return value.replace(/\r\n /g, ""); }

test("TEXT escaping preserves punctuation, backslashes and all newline forms without injecting properties", () => {
  expect(escapeIcsText("a,b;c\\d\ne\rf\r\ng")).toBe("a\\,b\\;c\\\\d\\ne\\nf\\ng");
  const text = unfold(generate([{ ...base, title: "Check, then; wait\\\r\nBEGIN:VEVENT" }]));
  expect(text.match(/^BEGIN:VEVENT$/gm)).toHaveLength(1);
  expect(text).toContain("SUMMARY:Check\\, then\\; wait\\\\\\nBEGIN:VEVENT · USNS Tern\r\n");
});

test("folding counts UTF-8 octets, does not split characters, and counts continuation whitespace", () => {
  const line = `DESCRIPTION:${"é航🛟".repeat(32)}`;
  const folded = foldIcsLine(line);
  expect(unfold(folded)).toBe(line);
  expect(folded).toContain("\r\n ");
  for (const part of folded.split("\r\n")) expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(75);
  expect(foldIcsLine("x".repeat(75))).toBe("x".repeat(75));
  expect(foldIcsLine("x".repeat(150))).toBe(`${"x".repeat(75)}\r\n ${"x".repeat(74)}\r\n x`);
});

test("VCALENDAR has CRLF, UTC timestamps, a stable UID and a 30-minute point duration", () => {
  const text = generate([{ ...base, start: "2026-11-05T10:00:00+02:00" }]);
  expect(text.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")).toBe(true);
  expect(text.endsWith("END:VCALENDAR\r\n")).toBe(true);
  expect(text.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
  const logical = unfold(text);
  expect(logical).toContain("UID:fictional-message%40r1#a1@otis.local\r\n");
  expect(logical).toContain("DTSTAMP:20261104T200102Z\r\n");
  expect(logical).toContain("DTSTART:20261105T080000Z\r\nDTEND:20261105T083000Z\r\n");
  expect(logical).toContain("SUMMARY:communications check · USNS Tern\r\n");
  expect(formatIcsUtc(new Date("2026-11-05T03:04:05.123-05:00"))).toBe("20261105T080405Z");
  expect(formatIcsUtc(Date.parse(base.start!))).toBe("20261105T080000Z");
  expect(calendarIcsUid(base)).toBe(calendarIcsUid({ ...base, factId: "a1" }));
  expect(calendarIcsUid({ messageKey: "a#b", factId: "c" })).not.toBe(calendarIcsUid({ messageKey: "a", factId: "b#c" }));
  expect(unfold(generateCalendarIcs(filterCalendarIcsEvents([base], { from, to }).events, { ...options, now: new Date() })))
    .toContain(`UID:${calendarIcsUid(base)}\r\n`);
});

test("description links to the source and includes a sent DTG only if loaded", () => {
  const event = { ...base, messageTitle: "Demo, only; tasking", ships: [ship, { key: "unit:demo-b", name: "USS Example, B" }] };
  const text = unfold(generate([event]));
  expect(text).toContain("CATEGORIES:USNS Tern,USS Example\\, B,communications check\r\n");
  expect(text).toContain("Source message: Demo\\, only\\; tasking\\nhttps://otis.example/messages?record=fictional-message%40r1&returnTo=%2Fcalendar%3Fdate%3D2026-11-05");
  expect(text).toContain("\\nUNCLASSIFIED // FICTIONAL DEMO DATA\r\n");
  expect(text).not.toContain("Sent DTG:");
  expect(unfold(generate([{ ...base, sentDtg: "2026-11-04T17:00:00Z" }]))).toContain("Sent DTG: 2026-11-04T17:00:00Z\\n");
});

test("a series master passes its RRULE through as structured syntax, not escaped TEXT", () => {
  const rule = "FREQ=WEEKLY;BYDAY=MO,TH;BYHOUR=8;BYMINUTE=0;UNTIL=20261112T235959Z";
  const text = unfold(generate([{ ...base, recurrenceRule: rule }]));
  expect(text).toContain(`RRULE:${rule}\r\n`);
  expect(text.match(/^BEGIN:VEVENT$/gm)).toHaveLength(1);
  expect(() => generate([{ ...base, recurrenceRule: "FREQ=DAILY\r\nSUMMARY:injected" }])).toThrow("Invalid recurrence rule");
});

test("ship and type selections intersect, multi-ship facts export once, and counts are unique messages", () => {
  const events = [base, base, { ...base, factId: "a2", ships: [ship, { key: "unit:demo-b", name: "USS Example B" }] },
    { ...base, messageKey: "fictional-other", factId: "a3", eventType: "crypto changeover" }];
  const result = filterCalendarIcsEvents(events, { from, to, ships: new Set([ship.key]), types: new Set([base.eventType]) });
  expect(result.events.map((event) => event.factId)).toEqual(["a1", "a2"]);
  expect(result.messageCount).toBe(1);
  expect(filterCalendarIcsEvents(events, { from, to }).messageCount).toBe(2);
  expect(filterCalendarIcsEvents(events, { from, to, ships: new Set() }).events).toHaveLength(0);
  expect(filterCalendarIcsEvents(events, { from, to, types: new Set() }).events).toHaveLength(0);
  expect(filterCalendarIcsEvents(events, { from, to, ships: new Set(["unit:demo-b"]) }).events.map((event) => event.factId)).toEqual(["a2"]);
});

test("range filtering uses half-open points and overlapping intervals without clipping", () => {
  const events: CalendarIcsEvent[] = [
    { ...base, factId: "before", start: "2026-11-04T23:59:00Z" },
    { ...base, factId: "first", start: "2026-11-05T00:00:00Z" },
    { ...base, factId: "last", start: "2026-11-12T23:59:00Z" },
    { ...base, factId: "after", start: "2026-11-13T00:00:00Z" },
    { ...base, factId: "overlap", kind: "interval", start: "2026-11-04T23:00:00Z", end: "2026-11-05T01:00:00Z" },
    { ...base, factId: "ends-before", kind: "interval", start: "2026-11-04T23:00:00Z", end: "2026-11-05T00:00:00Z" },
  ];
  const result = filterCalendarIcsEvents(events, { from, to });
  expect(result.events.map((event) => event.factId)).toEqual(["overlap", "first", "last"]);
  expect(result.events[0].startMs).toBe(Date.parse("2026-11-04T23:00:00Z"));
  expect(unfold(generate(events))).toContain("DTSTART:20261104T230000Z\r\nDTEND:20261105T010000Z");
});

test("untimed count follows ship/type filters, rejects invalid times, and never substitutes the current time", () => {
  const events: CalendarIcsEvent[] = [base,
    { ...base, factId: "missing", start: undefined },
    { ...base, factId: "bad", start: "not-a-date" },
    { ...base, factId: "local", start: "2026-11-05T08:00:00" },
    { ...base, factId: "unknown", kind: "unresolved" },
    { ...base, factId: "incomplete", kind: "interval" },
    { ...base, factId: "backwards", kind: "interval", end: "2026-11-05T07:00:00Z" },
    { ...base, factId: "zero", kind: "interval", end: base.start },
    { ...base, factId: "other-type", kind: "unresolved", eventType: "other type" },
    { ...base, factId: "other-ship", kind: "unresolved", ships: [{ key: "unassigned:", name: "Unassigned" }] },
  ];
  const result = filterCalendarIcsEvents(events, { from, to, ships: new Set([ship.key]), types: new Set([base.eventType]) });
  expect(result.events).toHaveLength(1);
  expect(result.skippedUntimed).toBe(7);
  expect(filterCalendarIcsEvents(events, { from, to, ships: new Set() }).skippedUntimed).toBe(0);
});

test("canonical adaptation exports bounded recurrence occurrences without duplicate prototypes or RRULE", () => {
  const message = create(MessageRecordSchema, { sourceMessageId: base.messageKey, subject: "Synthetic recurring task",
    events: [{ sourceEventId: "a1", title: "communications check" }] });
  const occurrences: TimelineItem[] = ["08", "20"].map((hour) => {
    const at = `2026-11-05T${hour}:00:00Z`, factId = `r1@${at}`;
    return { key: `${base.messageKey}#${factId}`, messageKey: base.messageKey, factId, sourceFactId: "r1", title: base.title,
      kind: "point", at, reviewRequired: true, commandIds: ["demo-tern", "demo-b"], sourceType: "OPTASK COMMS",
      recurrence: { ruleFactId: "r1", occurrenceId: factId, rule: "FREQ=DAILY;BYHOUR=8,20", description: "Synthetic daily checks", ongoing: true } };
  });
  const review: TimelineItem = { key: "untimed", messageKey: base.messageKey, factId: "untimed", title: "crypto changeover", kind: "unresolved", reviewRequired: true };
  const events = calendarIcsEvents([message], { timelineItems: occurrences, reviewItems: [review], messageHeaders: { [base.messageKey]: { issuedAt: "2026-11-04T20:00:00Z" } } },
    [{ id: "demo-tern", name: ship.name, shortLabel: "TERN", group: "Fictional", colorIndex: 0, isOwnShip: false }], "canonical");
  const result = filterCalendarIcsEvents(events, { from, to });
  expect(result.events).toHaveLength(2);
  expect(result.skippedUntimed).toBe(1);
  expect(events[0].eventType).toBe(base.title);
  expect(events[0].ships.map((value) => value.name)).toEqual([ship.name, "demo-b"]);
  expect(events[2].ships[0].key).toBe("unassigned:");
  const text = unfold(generateCalendarIcs(result.events, options));
  expect(text.match(/^BEGIN:VEVENT$/gm)).toHaveLength(2);
  expect(text).not.toContain("RRULE:");
  expect(text).toContain("Sent DTG: 2026-11-04T20:00:00Z");
  expect(calendarIcsUid(result.events[0])).not.toBe(calendarIcsUid(result.events[1]));
  expect(calendarIcsEvents([message], {}, [], "canonical")).toEqual([]);
});

test("legacy adapter preserves source identity and incomplete intervals remain excluded", () => {
  const message = create(MessageRecordSchema, { sourceMessageId: "legacy:fictional", events: [
    { id: 7n, sourceEventId: "fact-a", title: "Synthetic check", unit: "USS Example", startAt: { seconds: BigInt(from / 1000) }, endAt: { seconds: BigInt(from / 1000 + 3600) } },
    { id: 8n, title: "", startAt: { seconds: BigInt(from / 1000) } },
  ] });
  const events = calendarIcsEvents([message], {}, [], "legacy");
  expect(events[0].factId).toBe("fact-a");
  expect(events[0].ships).toEqual([{ key: "unit:USS Example", name: "USS Example" }]);
  expect(events[1].factId).toBe("8");
  expect(events[1].title).toBe("Untitled event");
  const filtered = filterCalendarIcsEvents(events, { from, to });
  expect(filtered.events).toHaveLength(1);
  expect(filtered.skippedUntimed).toBe(1);
});

test("UTC date defaults and inclusive range validation handle month/year boundaries and API limits", () => {
  expect(calendarExportEnd("2026-12-28")).toBe("2027-01-04");
  expect(calendarExportRange("2026-11-05", "2026-11-12")).toEqual({ from, to });
  expect(calendarExportRange("2026-11-05", "2026-11-05")).toEqual({ from, to: from + 86_400_000 });
  expect(calendarExportRange("2026-11-05", "2026-12-16")).toBeDefined();
  expect(calendarExportRange("2026-11-05", "2026-12-17")).toBeUndefined();
  expect(calendarExportRange("2026-11-05", "2026-11-04")).toBeUndefined();
  expect(calendarExportRange("2026-02-30", "2026-03-02")).toBeUndefined();
  expect(calendarExportRange("", "2026-11-05")).toBeUndefined();
});
