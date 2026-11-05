import { useRef } from "react";
import { expect, test } from "bun:test";
import { fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../test-utils/render";
import { calendarGridWidth, openingScrollTime, useOpeningScroll } from "./calendar-viewport";

const from = Date.parse("2026-11-05T00:00:00Z");
const to = from + 24 * 3_600_000;
test("seven days and five ships fit a 1280px workspace regardless of collision count", () => {
  for (const width of [1280, 1440]) {
    const available = width - 64 - 224 - 16 - 32 - 2; // main padding, sidebar, gap, calendar padding, border
    expect(calendarGridWidth("week", false, 0, 20)).toBeLessThanOrEqual(available);
    expect(calendarGridWidth("day", true, 5, 20)).toBeLessThanOrEqual(available);
  }
  expect(calendarGridWidth("day", true, 5, 20)).toBe(892);
  expect(calendarGridWidth("week", false, 0, 20)).toBe(836);
});
test("opening uses earlier of visible source time and now minus one hour; pinned dates use source time", () => {
  const first = from + 14.5 * 3_600_000;
  expect(openingScrollTime(from, to, [first], from + 17 * 3_600_000, "day", "UTC")).toBe(first);
  expect(openingScrollTime(from, to, [first], from + 13 * 3_600_000, "day", "UTC")).toBe(from + 12 * 3_600_000);
  expect(openingScrollTime(from, to, [first], to + 12 * 3_600_000, "day", "UTC")).toBe(first);
  expect(openingScrollTime(from, to, [], to + 12 * 3_600_000, "day", "UTC")).toBe(from);
  expect(openingScrollTime(from, to, [from - 3_600_000], from + 13 * 3_600_000, "day", "UTC")).toBe(from);
  const week = Date.parse("2026-11-01T00:00:00Z");
  expect(openingScrollTime(week, week + 7 * 86400000, [first], from + 10 * 3_600_000, "week", "UTC")).toBe(week + 9 * 3_600_000);
});
function Probe({ ready, fraction, windowKey = "first" }: { ready: boolean; fraction: number; windowKey?: string }) {
  const root = useRef<HTMLDivElement>(null);
  useOpeningScroll(root, windowKey, ready, fraction);
  return <div ref={root}><div className="rbc-time-content" data-testid="scroller" /></div>;
}
test("opening waits for source data, runs once and never overrides manual wheel movement", async () => {
  const view = renderWithProviders(<Probe ready={false} fraction={0.5} />);
  const scroller = view.getByTestId("scroller");
  Object.defineProperty(scroller, "scrollHeight", { value: 1000, configurable: true });
  expect(scroller.scrollTop).toBe(0);
  view.rerender(<Probe ready fraction={0.5} />);
  await waitFor(() => expect(scroller.scrollTop).toBe(500));
  scroller.scrollTop = 90;
  view.rerender(<Probe ready={false} fraction={0.75} />);
  view.rerender(<Probe ready fraction={0.75} />);
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  expect(scroller.scrollTop).toBe(90);
  view.rerender(<Probe ready fraction={0.75} windowKey="second" />);
  fireEvent.wheel(scroller, { deltaY: -120 });
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  expect(scroller.scrollTop).toBe(90);
  view.unmount();
});
