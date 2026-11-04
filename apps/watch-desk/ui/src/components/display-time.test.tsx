import { test, expect } from "bun:test";
import { renderWithProviders } from "../test-utils/render";
import {
  DisplayTimeProvider,
  civilHour,
  displayTimestamp,
  TIME_MODE_KEY,
  useDisplayTime,
} from "./display-time";
import { calendarLocalizer } from "./calendar-localizer";
import { monthBounds } from "./calendar-time";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";

test("application display stays in UTC despite a previously saved local preference", () => {
  localStorage.setItem(TIME_MODE_KEY, "local");
  function DisplayProbe() {
    const { mode, zone, format } = useDisplayTime();
    return (
      <p>
        {mode} · {zone} · {format(timestampFromDate(new Date("2026-11-04T12:00:00Z")))}
      </p>
    );
  }
  try {
    const view = renderWithProviders(
      <DisplayTimeProvider>
        <DisplayProbe />
      </DisplayTimeProvider>
    );
    expect(view.getByText(/utc · UTC · 2026-11-04 12:00/)).toBeTruthy();
  } finally {
    localStorage.removeItem(TIME_MODE_KEY);
  }
});

test("civil days and slots preserve spring and repeated autumn instants", () => {
  const zone = "America/New_York";
  for (const [date, hours] of [
    ["2026-03-08", 23],
    ["2026-11-01", 25],
  ] as const) {
    expect((civilHour(date, 24, zone) - civilHour(date, 0, zone)) / 3600000).toBe(hours);
  }
  expect(monthBounds("2026-03-08", zone).days).toBe(31);
  const localizer = calendarLocalizer(zone);
  const first = new Date("2026-11-01T05:30:00Z");
  const second = new Date("2026-11-01T06:30:00Z");
  expect(localizer.getMinutesFromMidnight(first)).toBe(90);
  expect(localizer.getMinutesFromMidnight(second)).toBe(150);
  expect(+localizer.getSlotDate(first, 0, 150)).toBe(+second);
  expect(displayTimestamp(timestampFromDate(first), "local", zone)).toContain("01:30:00 UTC-04:00");
  expect(displayTimestamp(timestampFromDate(second), "local", zone)).toContain(
    "01:30:00 UTC-05:00"
  );
  expect(displayTimestamp(timestampFromDate(first), "local", "Asia/Kathmandu")).toContain(
    "11:15:00 UTC+05:45"
  );
  expect(first.toISOString()).toBe("2026-11-01T05:30:00.000Z");
});
