import { expect, test } from "bun:test";
import { reviewTime } from "./review-time";
import type { TimelineItem } from "./source-data";
const item: TimelineItem = { key: "fictional#a1", messageKey: "fictional", title: "Window", kind: "unresolved", reviewRequired: true };
test("review distinguishes raw labels from normalized clocks without inventing dates", () => {
  expect(reviewTime({ ...item, timeDetails: [
    { endpoint: "start", status: "missing_date", clock: "12:00Z" },
    { endpoint: "end", status: "missing_date", clock: "18:00Z" },
  ] })).toBe("No date in source: 1200Z–1800Z (day not given; normalized clocks) · not plotted");
  expect(reviewTime({ ...item, timeDetails: [{ endpoint: "time", status: "missing_month_and_year", label: "051200Z" }] })).toBe("Time: Month and year missing — 051200Z · not plotted");
  expect(reviewTime({ ...item, timeDetails: [{ endpoint: "start", at: "2026-11-05T08:00:00Z" }] })).toContain("End: not supplied");
  expect(reviewTime({ ...item, reasonCode: "non_positive_interval" })).toBe("End is not after start · not plotted");
  expect(reviewTime({ ...item, reasonCode: "missing_time" })).toBe("No date or time supplied · not plotted");
  expect(reviewTime({ ...item, timeDetails: [{ endpoint: "end", status: "open_ended", label: "UFN" }] })).toContain("End is open; no duration supplied — UFN");
  expect(reviewTime({ ...item, timeDetails: [{ endpoint: "time", status: "missing_date_and_zone", clock: "12:00" }] })).toContain("Date and time zone missing — 1200 (normalized clock)");
  expect(reviewTime(item)).toContain("details unavailable");
});
