import { expect, test } from "bun:test";
import { calendarLanes } from "./calendar-layout";

test("short and point card footprints reserve collision lanes without changing source events", () => {
  const source = [
    { id: "guard", start: 0, end: 100 },
    { id: "point", start: 30, end: 30 },
    { id: "plan", start: 31, end: 45 },
    { id: "later", start: 70, end: 80 },
  ];
  const before = JSON.stringify(source);
  const placed = calendarLanes(
    source.map((event) => ({
      event,
      top: event.start,
      height: Math.max(4, event.end - event.start),
    }))
  );
  expect(placed.find((item) => item.event.id === "point")!.lane).not.toBe(
    placed.find((item) => item.event.id === "plan")!.lane
  );
  expect(placed.every((item) => item.columns === 3)).toBe(true);
  expect(JSON.stringify(source)).toBe(before);
  for (const left of placed) {
    for (const right of placed) {
      if (left !== right && left.lane === right.lane) {
        expect(left.top + left.height <= right.top || right.top + right.height <= left.top).toBe(
          true
        );
      }
    }
  }
});

test("touching events reuse a lane and disconnected groups regain full width", () => {
  const placed = calendarLanes([
    { event: "a", top: 0, height: 5 },
    { event: "b", top: 0, height: 5 },
    { event: "c", top: 5, height: 5 },
  ]);
  expect(placed.find((item) => item.event === "a")!.columns).toBe(2);
  expect(placed.find((item) => item.event === "c")!.columns).toBe(1);
  expect(calendarLanes([])).toEqual([]);
});
