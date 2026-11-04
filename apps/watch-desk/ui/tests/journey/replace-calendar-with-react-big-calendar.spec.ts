import { test, expect } from "@playwright/test";
import { withEphemeralStack } from "../../../ark/pipeline/journey-stack";
import { calendarEvent, expectCalendarSections, expectDayGeometry, expectMonthGrid } from "./calendar-assertions";

for (const timezoneId of ["UTC", "America/New_York"]) {
  test.describe(timezoneId, () => {
    test.use({ timezoneId });

    test("replace calendar with react-big-calendar", async ({ page }) => {
      const stack = await withEphemeralStack({
        fixture: "fixtures/read-the-daily-ship-schedule.json",
        storyId: "streamline-calendar-page-sections",
      });
      try {
        await page.setViewportSize({ width: 1440, height: 1100 });
        await page.emulateMedia({ colorScheme: "light" });
        await page.clock.setFixedTime(new Date("2026-11-04T00:30:00Z"));
        await page.goto(stack.url);
        const date = page.getByLabel("UTC date", { exact: true });
        const interval = page.getByRole("combobox", { name: /^Grid interval/ });
        const hours = page.getByRole("combobox", { name: /^Visible hours \(UTC\)/ });
        const timeView = page.locator(".rbc-time-view");
        await date.fill("2026-11-04");
        await page.getByRole("searchbox").fill("fictional");
        await expect(timeView).toBeVisible();
        await page.getByRole("button", { name: "Today", exact: true }).click();
        await expect(date).toHaveValue("2026-11-04");
        await expect(page.locator(".rbc-current-time-indicator")).toHaveCount(1);
        await expect.poll(() => page.locator(".rbc-current-time-indicator").evaluate((element) => parseFloat((element as HTMLElement).style.top))).toBeCloseTo(100 * 0.5 / 24, 1);
        await expectDayGeometry(page, "Fictional crew briefing", 8 / 24, 0.5 / 24);
        await expectDayGeometry(page, "Fictional equipment check", 8.25 / 24, 0.75 / 24);
        await expectCalendarSections(page);
        await expect(calendarEvent(page, "Fictional crew briefing")).toContainText("2026-11-04 08:00 UTC");
        await expect(calendarEvent(page, "Fictional crew briefing")).toContainText("2026-11-04 08:30 UTC");
        const upcoming = page.getByRole("region", { name: "Next upcoming events", exact: true });
        await expect(upcoming.getByRole("listitem").filter({ has: page.getByRole("link", { name: "Fictional crew briefing", exact: true }) })).toContainText("Wardroom");
        const revised = calendarEvent(page, "Fictional revised replenishment");
        await expect(revised).toContainText("Revised");
        await expect(calendarEvent(page, "Fictional inspection — needs review")).toHaveCount(0);
        const revisionURL = page.url();
        await revised.click();
        const revisionReader = page.getByRole("article", { name: "Selected message" });
        await expect(revisionReader).toContainText("2026-11-04 13:00 UTC");
        await expect(revisionReader).toContainText("2026-11-04 14:00 UTC");
        await page.getByRole("link", { name: "Return to Calendar", exact: true }).click();
        await expect(page).toHaveURL(revisionURL);
        await interval.selectOption("30");
        await expect(timeView.locator(".rbc-day-slot .rbc-time-slot")).toHaveCount(48);
        await expectDayGeometry(page, "Fictional equipment check", 8.25 / 24, 0.75 / 24);
        await hours.selectOption("6-12");
        await expect(page.locator(".rbc-current-time-indicator")).toHaveCount(0);
        await expect(timeView.locator(".rbc-day-slot .rbc-time-slot")).toHaveCount(12);
        await expectDayGeometry(page, "Fictional crew briefing", 2 / 6, 0.5 / 6);
        await expectDayGeometry(page, "Fictional equipment check", 2.25 / 6, 0.75 / 6);

        if (timezoneId === "UTC") {
          await page.locator(".calendar-scroll").scrollIntoViewIfNeeded();
          await stack.screenshot({ page, deliverable: true });
          await page.setViewportSize({ width: 390, height: 844 });
          await expectCalendarSections(page);
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
          await page.locator(".calendar-scroll").scrollIntoViewIfNeeded();
          await stack.screenshot({ page, deliverable: true, name: "day-narrow" });
          await page.emulateMedia({ colorScheme: "dark" });
          await stack.screenshot({ page, deliverable: true, name: "journey-day-narrow-dark" });
          await upcoming.scrollIntoViewIfNeeded();
          await stack.screenshot({ page, deliverable: true, name: "journey-upcoming-dark" });
          await page.emulateMedia({ colorScheme: "light" });
          await page.setViewportSize({ width: 1440, height: 1100 });
          await page.emulateMedia({ colorScheme: "dark" });
          await page.locator(".calendar-scroll").scrollIntoViewIfNeeded();
          await stack.screenshot({ page, deliverable: true, name: "journey-day-desktop-dark" });
          await page.emulateMedia({ colorScheme: "light" });
        }

        const calendarURL = page.url();
        await timeView.getByRole("link", { name: "Fictional equipment check, source record", exact: true }).click();
        const reader = page.getByRole("article", { name: "Selected message" });
        await expect(reader.getByRole("heading", { name: "Fictional Meridian daily activities", exact: true })).toBeVisible();
        await page.reload();
        await expect(reader).toContainText("Fictional equipment check");
        await page.getByRole("link", { name: "Return to Calendar", exact: true }).click();
        await expect(page).toHaveURL(calendarURL);
        await expect(interval).toHaveValue("30");
        await expect(hours).toHaveValue("6-12");
        await expect(page.getByRole("searchbox")).toHaveValue("fictional");
        await expectDayGeometry(page, "Fictional equipment check", 2.25 / 6, 0.75 / 6);

        await page.getByRole("button", { name: "Month", exact: true }).click();
        await expectMonthGrid(page, 2026, 11, 30);
        await expectCalendarSections(page);
        const span = page.locator(".rbc-month-view .rbc-row-segment").filter({ has: page.getByRole("link", { name: "Fictional multi-day exercise, source record", exact: true }) });
        // Month event packing follows the view's initial render. Wait for its
        // measured layout without weakening the three-day span requirement.
        await expect(span).toBeVisible();
        await expect.poll(() => span.evaluate((element) => element.getBoundingClientRect().width / element.closest(".rbc-month-row")!.getBoundingClientRect().width)).toBeCloseTo(3 / 7, 2);
        const more = page.locator(".rbc-month-view .rbc-show-more").first();
        await expect(more).toBeVisible();
        await more.focus();
        await page.keyboard.press("Enter");
        const popup = page.locator(".rbc-overlay");
        await expect(popup).toBeVisible();
        const overflowURL = page.url();
        await popup.getByRole("link", { name: "Fictional equipment check, source record", exact: true }).click();
        await expect(reader).toContainText("Fictional Meridian daily activities");
        await page.reload();
        await page.getByRole("link", { name: "Return to Calendar", exact: true }).click();
        await expect(page).toHaveURL(overflowURL);
        await expectMonthGrid(page, 2026, 11, 30);
        await expect(interval).toBeDisabled();
        await expect(hours).toBeDisabled();
        if (timezoneId === "UTC") {
          await page.locator(".calendar-scroll").scrollIntoViewIfNeeded();
          await stack.screenshot({ page, deliverable: true, name: "month-desktop" });
          await page.setViewportSize({ width: 390, height: 844 });
          await expectCalendarSections(page);
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
          await page.locator(".calendar-scroll").scrollIntoViewIfNeeded();
          await stack.screenshot({ page, deliverable: true, name: "month-narrow" });
          await page.setViewportSize({ width: 1440, height: 1100 });
          await page.emulateMedia({ colorScheme: "dark" });
          await page.locator(".calendar-scroll").scrollIntoViewIfNeeded();
          await stack.screenshot({ page, deliverable: true, name: "journey-month-desktop-dark" });
          await page.emulateMedia({ colorScheme: "light" });
        }
        await page.getByRole("button", { name: "Next month", exact: true }).click();
        await expect(date).toHaveValue("2026-12-01");
        await expectMonthGrid(page, 2026, 12, 31);
        await page.getByRole("button", { name: "Previous month", exact: true }).click();
        await expect(date).toHaveValue("2026-11-01");
        const day = page.getByRole("button", { name: "Open 2026-11-05 in Day view", exact: true });
        await day.focus();
        await page.keyboard.press("Enter");
        await expect(date).toHaveValue("2026-11-05");
        await expect(page.getByRole("button", { name: "Day", exact: true })).toHaveAttribute("aria-pressed", "true");
        await expect(interval).toHaveValue("30");
        await expect(hours).toHaveValue("6-12");

        await hours.selectOption("0-24");
        // selectOption dispatches change before router navigation necessarily
        // commits. Do not let the following date edit reuse the old hours URL.
        await expect(page).toHaveURL(/hours=0-24/);
        await expect(timeView.locator(".rbc-day-slot .rbc-time-slot")).toHaveCount(48);
        // Both US DST transitions must remain ordinary 24-hour UTC columns.
        for (const [value, title, start, end] of [
          ["2026-03-08", "Fictional spring watch", 6.5, 8.5],
          ["2026-11-01", "Fictional autumn watch", 5.5, 7.5],
        ] as const) {
          await date.fill(value);
          await expectDayGeometry(page, title, start / 24, (end - start) / 24);
          await expect(timeView.locator(".rbc-day-slot .rbc-time-slot")).toHaveCount(48);
          await expect(calendarEvent(page, title)).toContainText(`${value} ${String(Math.floor(start)).padStart(2, "0")}:30 UTC`);
          await expect(calendarEvent(page, title)).toContainText(`${value} ${String(Math.floor(end)).padStart(2, "0")}:30 UTC`);
          await page.reload();
          await expectDayGeometry(page, title, start / 24, (end - start) / 24);
          await page.getByRole("button", { name: "Next day", exact: true }).click();
          await expect(date).toHaveValue(value === "2026-03-08" ? "2026-03-09" : "2026-11-02");
          await expect(calendarEvent(page, title)).toHaveCount(0);
          await page.getByRole("button", { name: "Previous day", exact: true }).click();
          await expect(date).toHaveValue(value);
        }
        await expectDayGeometry(page, "Fictional UTC boundary watch", 23.5 / 24, 0.5 / 24);
        await expect(calendarEvent(page, "Fictional UTC boundary watch")).toContainText("Continues later");
        await page.getByRole("button", { name: "Next day", exact: true }).click();
        await expectDayGeometry(page, "Fictional UTC boundary watch", 0, 0.5 / 24);
        await expect(calendarEvent(page, "Fictional UTC boundary watch")).toContainText("Continues from earlier");
        await expect(calendarEvent(page, "Fictional UTC boundary watch")).not.toContainText("Continues later");
        // The available-date helper must not interrupt adjacency in an empty period either.
        await date.fill("2027-01-01");
        for (const width of [1440, 390]) {
          await page.setViewportSize({ width, height: 1100 });
          for (const view of ["Day", "Month"]) {
            await page.getByRole("button", { name: view, exact: true }).click();
            await expectCalendarSections(page);
            await expect(page.getByRole("button", { name: "Open available event date", exact: true })).toBeVisible();
          }
        }
        await page.getByRole("button", { name: "Open available event date", exact: true }).click();
        await expect(date).toHaveValue("2026-03-08");
        await expect(hours).toHaveValue("0-24");
        await expect(interval).toHaveValue("30");
        await expect(page.getByRole("searchbox")).toHaveValue("fictional");
        await expect(page.getByRole("button", { name: "Month", exact: true })).toHaveAttribute("aria-pressed", "true");
        await stack.assertNoServerErrors();
      } finally {
        await stack.teardown();
      }
    });
  });
}
