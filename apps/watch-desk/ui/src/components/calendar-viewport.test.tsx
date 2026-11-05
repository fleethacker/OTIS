import { useRef } from "react";
import { expect, test } from "bun:test";
import { fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../test-utils/render";
import { calendarGridWidth, openingScrollTime, useOpeningScroll } from "./calendar-viewport";

const from = Date.parse("2026-11-05T00:00:00Z");
const to = from + 24 * 3_600_000;
test("sparse days/ships fit, dense lanes retain 128px rather than shrinking titles", () => {
  expect(calendarGridWidth("day", true, 5, 1)).toBe(892);
  expect(calendarGridWidth("day", true, 5, 2)).toBe(52 + 5 * 256);
  expect(calendarGridWidth("week", false, 0, 1)).toBe(52 + 7 * 128);
  // Only Thursday grows in Fit; do not multiply the busiest day by seven.
  expect(calendarGridWidth("week", false, 0, 5, false, [1, 1, 1, 1, 5, 1, 1])).toBe(
    52 + 6 * 128 + 5 * 128
  );
});
test("Expanded Week retains equal lane-proportional columns", () => {
  expect(calendarGridWidth("week", false, 0, 3, true)).toBe(52 + 7 * 3 * 128);
  expect(calendarGridWidth("week", false, 0, 3, false, [1, 1, 1, 1, 3, 1, 1])).toBe(
    52 + 6 * 128 + 3 * 128
  );
});
test("opening uses earlier of visible source time and now minus one hour; pinned dates use source time", () => {
  const first = from + 14.5 * 3_600_000;
  expect(openingScrollTime(from, to, [first], from + 17 * 3_600_000, "day", "UTC")).toBe(first);
  expect(openingScrollTime(from, to, [first], from + 13 * 3_600_000, "day", "UTC")).toBe(
    from + 12 * 3_600_000
  );
  expect(openingScrollTime(from, to, [first], to + 12 * 3_600_000, "day", "UTC")).toBe(first);
  expect(openingScrollTime(from, to, [], to + 12 * 3_600_000, "day", "UTC")).toBe(from);
  expect(openingScrollTime(from, to, [from - 3_600_000], from + 13 * 3_600_000, "day", "UTC")).toBe(
    from
  );
  const week = Date.parse("2026-11-01T00:00:00Z");
  expect(
    openingScrollTime(week, week + 7 * 86400000, [first], from + 10 * 3_600_000, "week", "UTC")
  ).toBe(week + 9 * 3_600_000);
});
function Probe({
  ready,
  fraction,
  windowKey = "first",
}: {
  ready: boolean;
  fraction: number;
  windowKey?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  useOpeningScroll(root, windowKey, ready, fraction);
  return (
    <div ref={root}>
      <div className="rbc-time-content" data-testid="scroller" />
    </div>
  );
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
