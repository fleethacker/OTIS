import { test, expect } from "@playwright/test";
import { withEphemeralStack } from "../../../ark/pipeline/journey-stack";
import { calendarEvent, expectMonthGrid } from "./calendar-assertions";

test("month projection and source round trip", async ({ page }) => {
  const stack = await withEphemeralStack({ fixture: "fixtures/read-the-daily-ship-schedule.json", storyId: "explore-the-monthly-ship-schedule" });
  try {
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto(`${stack.url}/calendar?date=2026-11-04&interval=30&hours=6-12&q=fictional`); // direct-url: exercise persisted non-default calendar context with a query matching the fixture
    await page.getByRole("button", { name: "Month", exact: true }).click();
    const date = page.getByLabel("UTC date", { exact: true });
    await expectMonthGrid(page, 2026, 11, 30);
    await expect(page.locator(".rbc-month-view").getByRole("link", { name: "Fictional crew briefing, source record", exact: true })).toBeVisible();
    const monthEnd = calendarEvent(page, "Fictional month-end watch", ".rbc-month-view");
    await expect(monthEnd).toContainText("Continues later");
    await expect(calendarEvent(page, "Fictional inspection — needs review", ".rbc-month-view")).toHaveCount(0);
    await page.locator(".rbc-month-view .rbc-show-more").first().click();
    await expect(calendarEvent(page, "Fictional revised replenishment", ".rbc-overlay")).toContainText("Revised");
    await page.keyboard.press("Escape");
    await page.locator(".timeline-toolbar").click();
    await stack.screenshot({ page, deliverable: true });
    const day = page.getByRole("button", { name: "Open 2026-11-05 in Day view" });
    await day.focus(); await page.keyboard.press("Enter");
    await expect(date).toHaveValue("2026-11-05");
    await expect(page.getByRole("button", { name: "Day", exact: true })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Month", exact: true }).click();
    const url = page.url();
    await page.locator(".rbc-month-view .rbc-show-more").first().click();
    await calendarEvent(page, "Fictional night watch", ".rbc-overlay").click();
    await page.reload();
    await page.getByRole("link", { name: "Return to Calendar", exact: true }).click();
    await expect(page).toHaveURL(url);
    await expect(page.getByLabel("Grid interval")).toHaveValue("30");
    await expect(page.getByLabel("Visible hours (UTC)")).toHaveValue("6-12");
    await page.getByRole("button", { name: "Next month", exact: true }).click();
    await expect(date).toHaveValue("2026-12-01");
    await expectMonthGrid(page, 2026, 12, 31);
    await expect(monthEnd).toContainText("Continues from earlier");
    await page.getByRole("button", { name: "Next month", exact: true }).click();
    await expect(date).toHaveValue("2027-01-01");
    await page.getByRole("button", { name: "Previous month", exact: true }).click();
    await expect(date).toHaveValue("2026-12-01");
    for (const [value, days] of [["2025-02-28",28],["2024-02-29",29],["2026-04-30",30],["2026-12-31",31]] as const) {
      await date.fill(value);
      await expectMonthGrid(page, Number(value.slice(0, 4)), Number(value.slice(5, 7)), days);
    }
    await date.fill("2026-11-04");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: "dark" });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator(".calendar-scroll").scrollIntoViewIfNeeded();
    await stack.screenshot({ page, deliverable: true, name: "month-mobile-dark" });
    await page.route("**/app.v1.SourceDataService/ReadSchedules", route => route.fulfill({ status: 200, contentType: "application/json", body: '{"messages":[]}' }));
    await page.reload();
    await expect(page.getByRole("heading", { name: "Schedule data unavailable" })).toBeVisible();
    await page.unroute("**/app.v1.SourceDataService/ReadSchedules");
    await stack.expectBrowserHTTPError({ path: "/app.v1.SourceDataService/ReadSchedules", status: 503, reason: "Month outage state" });
    await page.route("**/app.v1.SourceDataService/ReadSchedules", route => route.fulfill({ status: 503, contentType: "application/json", body: '{"code":"unavailable","message":"Controlled outage"}' }));
    await page.reload();
    await expect(page.getByRole("alert")).toContainText("Schedule could not be loaded", { timeout: 15000 });
    await page.unroute("**/app.v1.SourceDataService/ReadSchedules");
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await stack.assertNoServerErrors();
  } finally { await stack.teardown(); }
});
