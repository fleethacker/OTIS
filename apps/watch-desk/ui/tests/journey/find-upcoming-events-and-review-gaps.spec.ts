import { test, expect } from "@playwright/test";
import { withEphemeralStack } from "../../../ark/pipeline/journey-stack";
import { calendarEvent, expectCalendarSections } from "./calendar-assertions";

test("shared search, upcoming chronology and source review round trip", async ({ page }) => {
  const stack = await withEphemeralStack({ fixture: "fixtures/find-upcoming-events-and-review-gaps.json", storyId: "find-upcoming-events-and-review-gaps" });
  try {
    await page.clock.setFixedTime(new Date("2026-11-04T07:00:00Z"));
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto(stack.url);
    const search = page.getByRole("searchbox", { name: "Search schedule" });
    const upcoming = page.getByRole("region", { name: "Next upcoming events" });
    await expect(upcoming.getByRole("listitem")).toHaveCount(5);
    await expect(upcoming.getByRole("listitem").first()).toContainText("Fictional briefing");
    await expect(upcoming.getByRole("listitem").last()).toContainText("Fictional exercise");
    await expect(upcoming).toContainText("Location unavailable");
    await expect(upcoming).toContainText("Revised");
    await expect(upcoming.getByRole("listitem").first()).toContainText("Wardroom");
    await expect(upcoming.getByRole("listitem").first()).toContainText("2026-11-04 08:00 UTC");
    await search.fill("COPPER LANTERN");
    await expect(upcoming.getByRole("listitem")).toHaveCount(5);
    await expect(calendarEvent(page, "Fictional revised replenishment")).toHaveCount(0);
    await page.getByRole("button", { name: "Month", exact: true }).click();
    await expect(calendarEvent(page, "Fictional night watch", ".rbc-month-view")).toBeVisible();
    await page.getByRole("button", { name: "Day", exact: true }).click();
    await page.getByLabel("Grid interval").selectOption("30");
    await page.getByLabel("Visible hours (UTC)").selectOption("6-12");
    const context = page.url();
    await upcoming.getByRole("link", { name: "Fictional equipment check", exact: true }).click();
    await expect(page).toHaveURL(/record=FICTIONAL-001/);
    await page.getByRole("link", { name: "Return to Calendar", exact: true }).click();
    await expect(page).toHaveURL(context);
    await search.fill("pending coordination");
    await expect(page.getByRole("region", { name: "Needs review" })).toContainText("FICTIONAL-003");
    await expect(upcoming).toContainText("No upcoming timed events");
    await expect(calendarEvent(page, "Fictional inspection")).toHaveCount(0);
    await page.getByRole("region", { name: "Needs review" }).getByRole("link").click();
    await expect(page).toHaveURL(/record=FICTIONAL-003/);
    await page.getByRole("link", { name: "Return to Calendar", exact: true }).click();
    await search.fill("not-present-anywhere");
    await expect(page.getByRole("heading", { name: "No matching schedules" })).toBeVisible();
    await search.fill("");
    await expect(upcoming.getByRole("listitem")).toHaveCount(5);
    await page.getByLabel("UTC date", { exact: true }).fill("2027-01-01");
    await expect(page.getByRole("heading", { name: "No timed events in this window" })).toBeVisible();
    await expectCalendarSections(page);
    await page.getByRole("button", { name: "Open available event date" }).click();
    await expect(page.getByLabel("UTC date", { exact: true })).toHaveValue("2026-11-04");
    await stack.screenshot({ page, deliverable: true });
    await upcoming.scrollIntoViewIfNeeded();
    await stack.screenshot({ page, deliverable: true, name: "journey-upcoming-light" });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: "dark" });
    await search.fill("copper lantern");
    await expect(upcoming.getByRole("listitem")).toHaveCount(5);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await stack.screenshot({ page, deliverable: true, name: "journey-mobile-dark" });
    await upcoming.scrollIntoViewIfNeeded();
    await stack.screenshot({ page, deliverable: true, name: "journey-upcoming-mobile" });
    await upcoming.getByRole("link", { name: "Fictional briefing", exact: true }).click();
    await expect(page).toHaveURL(/record=FICTIONAL-001/);
    await page.getByRole("link", { name: "Return to Calendar", exact: true }).click();
    await expect(search).toHaveValue("copper lantern");
    await stack.assertNoServerErrors();
  } finally { await stack.teardown(); }
});

test("pending snapshot uses latest query and failed retry never implies success", async ({ page }) => {
  const stack = await withEphemeralStack({ fixture: "fixtures/find-upcoming-events-and-review-gaps.json", storyId: "find-upcoming-events-and-review-gaps" });
  const path = "**/app.v1.SourceDataService/ReadSchedules";
  try {
    await page.clock.setFixedTime(new Date("2027-01-01T00:00:00Z"));
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    await page.route(path, async (route) => { await pending; await route.continue(); });
    await page.goto(stack.url);
    const search = page.getByRole("searchbox", { name: "Search schedule" });
    await search.fill("copper");
    await expect(search).toHaveValue("copper");
    await search.fill("pending coordination");
    await expect(page.getByRole("status").filter({ hasText: "Loading schedule" })).toBeVisible();
    release();
    await expect(page.getByRole("region", { name: "Needs review" })).toContainText("FICTIONAL-003");
    await expect(calendarEvent(page, "Fictional briefing")).toHaveCount(0);
    await search.fill("");
    await expect(page.getByRole("region", { name: "Next upcoming events" })).toContainText("No upcoming timed events available");
    await page.unroute(path);
    await stack.expectBrowserHTTPError({ path: "/app.v1.SourceDataService/ReadSchedules", status: 503, reason: "Verify failed refresh and retry" });
    await page.route(path, (route) => route.fulfill({ status: 503, contentType: "application/json", body: '{"code":"unavailable","message":"Controlled outage"}' }));
    await page.reload();
    await expect(page.getByRole("alert")).toContainText("Schedule could not be loaded", { timeout: 15000 });
    await Promise.all([
      page.waitForResponse((response) => response.url().endsWith("/app.v1.SourceDataService/ReadSchedules") && response.status() === 503),
      page.getByRole("button", { name: "Retry", exact: true }).click(),
    ]);
    await expect(page.getByRole("alert")).toContainText("No schedule data is confirmed", { timeout: 15000 });
    await expect(page.getByRole("region", { name: "Next upcoming events" })).toHaveCount(0);
    await page.unroute(path);
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(page.getByRole("region", { name: "Next upcoming events" })).toBeVisible();
    await stack.assertNoServerErrors();
  } finally { await stack.teardown(); }
});
