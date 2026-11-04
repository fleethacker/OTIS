import { test, expect } from "@playwright/test";
import { withEphemeralStack } from "../../../ark/pipeline/journey-stack";
import { calendarEvent, expectDayGeometry } from "./calendar-assertions";

test("read the daily ship schedule and return from its source", async ({ page }) => {
  const stack = await withEphemeralStack({ fixture: "fixtures/read-the-daily-ship-schedule.json", storyId: "read-the-daily-ship-schedule" });
  try {
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto(stack.url);
    const date = page.getByLabel("UTC date", { exact: true });
    const interval = page.getByRole("combobox", { name: /^Grid interval/ });
    const hours = page.getByRole("combobox", { name: /^Visible hours \(UTC\)/ });
    await date.fill("2026-11-04");
    await expect(page.getByRole("heading", { name: /Wednesday, 4 November 2026/ })).toBeVisible();

    async function expectGeometry(id: number, top: number, height: number) {
      const titles: Record<number, string> = { 1: "Fictional crew briefing", 2: "Fictional equipment check", 5: "Fictional night watch" };
      await expectDayGeometry(page, titles[id], top, height);
    }

    await expectGeometry(1, 8 / 24, 0.5 / 24);
    await expectGeometry(2, 8.25 / 24, 0.75 / 24);
    await expectGeometry(5, 23.5 / 24, 0.5 / 24);
    const nightWatch = calendarEvent(page, "Fictional night watch");
    await expect(nightWatch).toContainText("Continues later");
    await expect(calendarEvent(page, "Fictional inspection — needs review")).toHaveCount(0);
    await interval.selectOption("30");
    await expect(interval).toHaveValue("30");
    await expectGeometry(1, 8 / 24, 0.5 / 24);
    await expectGeometry(2, 8.25 / 24, 0.75 / 24);
    await expectGeometry(5, 23.5 / 24, 0.5 / 24);
    await stack.screenshot({ page, deliverable: true });

    await page.getByRole("button", { name: "Next day", exact: true }).click();
    await expect(date).toHaveValue("2026-11-05");
    await hours.selectOption("0-6");
    await page.goto(`${page.url()}&q=watch`); // direct-url: verify the reload-safe calendar state contract preserves an existing search query.
    await expect(hours).toHaveValue("0-6");
    await expectGeometry(5, 0, 1.5 / 6);
    await expect(nightWatch).toContainText("Continues from earlier");
    await expect(nightWatch).not.toContainText("Continues later");
    const calendarURL = page.url();
    await nightWatch.click();
    const reader = page.getByRole("article", { name: "Selected message" });
    await expect(reader.getByRole("heading", { name: "Fictional Meridian overnight watches" })).toBeVisible();
    await page.reload();
    await expect(reader.getByRole("heading", { name: "Fictional Meridian overnight watches" })).toBeVisible();
    await page.getByRole("link", { name: "Return to Calendar", exact: true }).click();
    await expect(page).toHaveURL(calendarURL);
    await expect(date).toHaveValue("2026-11-05");
    await expect(interval).toHaveValue("30");
    await expect(hours).toHaveValue("0-6");
    await expectGeometry(5, 0, 1.5 / 6);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(nightWatch).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await nightWatch.scrollIntoViewIfNeeded();
    await stack.screenshot({ page, deliverable: true, name: "journey-mobile-dark" });
    await page.getByRole("button", { name: "Previous day", exact: true }).click();
    await expect(date).toHaveValue("2026-11-04");
    await expect(page.getByRole("heading", { name: "No timed events in this window" })).toBeVisible();
    await page.getByRole("button", { name: "Today", exact: true }).click();
    expect([new Date().toISOString().slice(0, 10)]).toContain(await date.inputValue());
    await page.getByRole("button", { name: "Next day", exact: true }).focus();
    await expect(page.getByRole("button", { name: "Next day", exact: true })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(date).toHaveValue(new Date(Date.parse(new Date().toISOString().slice(0, 10)) + 86400000).toISOString().slice(0, 10));
    await page.route("**/app.v1.SourceDataService/ReadSchedules", route => route.fulfill({ status: 200, contentType: "application/json", body: '{"messages":[]}' }));
    await page.reload();
    await expect(page.getByRole("heading", { name: "Schedule data unavailable" })).toBeVisible();
    await page.unroute("**/app.v1.SourceDataService/ReadSchedules");
    await stack.expectBrowserHTTPError({ path: "/app.v1.SourceDataService/ReadSchedules", status: 503, reason: "Verify calendar outage and retry" });
    await page.route("**/app.v1.SourceDataService/ReadSchedules", route => route.fulfill({ status: 503, contentType: "application/json", body: '{"code":"unavailable","message":"Controlled outage"}' }));
    await page.reload();
    await expect(page.getByRole("alert")).toContainText("Schedule could not be loaded", { timeout: 15000 });
    await page.unroute("**/app.v1.SourceDataService/ReadSchedules");
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await stack.assertNoServerErrors();
  } finally {
    await stack.teardown();
  }
});
