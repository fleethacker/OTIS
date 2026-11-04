import { test, expect } from "@playwright/test";
import { withEphemeralStack } from "../../../ark/pipeline/journey-stack";
import { calendarEvent, expectCalendarSections } from "./calendar-assertions";

for (const timezoneId of ["UTC", "America/New_York", "Asia/Kathmandu"]) {
  test.describe(timezoneId, () => {
    test.use({ timezoneId });
    test("weekly windows, civil navigation and source return", async ({ page }) => {
      const stack = await withEphemeralStack({ fixture: "fixtures/view-weekly-ship-schedule.json", storyId: "view-weekly-ship-schedule" });
      try {
        await page.clock.setFixedTime(new Date("2026-11-04T12:00:00Z"));
        await page.setViewportSize({ width: 1440, height: 1100 });
        await page.goto(stack.url);
        await page.getByRole("button", { name: "Week", exact: true }).click();
        await page.getByLabel("UTC date", { exact: true }).fill("2026-11-04");
        await expect(page.getByRole("heading", { name: /01 Nov 2026 – 07 Nov 2026/ })).toBeVisible();
        await page.getByLabel("Grid interval").selectOption("30");
        await expect(page).toHaveURL(/interval=30/);
        await page.getByLabel("Visible hours (UTC)").selectOption("6-12");
        await expect(page).toHaveURL(/hours=6-12/);
        await page.getByRole("searchbox").fill("fictional");
        await expect(page).toHaveURL(/q=fictional/);
        await expect(calendarEvent(page, "Fictional last-day watch")).toBeVisible();
        await expect(calendarEvent(page, "Fictional unresolved watch")).toHaveCount(0);
        await page.getByRole("button", { name: "Local", exact: true }).click();
        await page.getByLabel("Visible hours (Local)").selectOption("0-24");
        const first = calendarEvent(page, "Fictional first watch");
        const second = calendarEvent(page, "Fictional second watch");
        await expect(first).toContainText("Revised");
        if (timezoneId === "America/New_York") {
          const position = async (title: string) => calendarEvent(page, title).evaluate((el) => parseFloat((el.closest(".rbc-event") as HTMLElement).style.top));
          expect(await position("Fictional first watch")).toBeCloseTo(100 * 1.5 / 25, 1);
          expect(await position("Fictional second watch")).toBeCloseTo(100 * 2.5 / 25, 1);
          expect(await position("Fictional ordinary-day watch")).toBeCloseTo(100 * 8 / 24, 1);
          await first.click();
          const details = page.getByRole("dialog", { name: "Fictional first watch", exact: true });
          await expect(details).toBeVisible();
          await expect(details.getByText("2026-11-01 01:30:00 UTC-04:00 → 2026-11-01 01:45:00 UTC-04:00", { exact: true })).toBeVisible();
          await expect(details.getByText("Revised", { exact: true })).toBeVisible();
          await expect(details).toContainText("Prior: 2026-11-01 01:15:00 UTC-04:00");
          await details.getByRole("button", { name: "Close details", exact: true }).click();
          await expect(details).not.toBeVisible();
          await second.click();
          const secondDetails = page.getByRole("dialog", { name: "Fictional second watch", exact: true });
          await expect(secondDetails.getByText("2026-11-01 01:30:00 UTC-05:00 → 2026-11-01 01:45:00 UTC-05:00", { exact: true })).toBeVisible();
          await secondDetails.getByRole("button", { name: "Close details", exact: true }).click();
          await expect(secondDetails).not.toBeVisible();
        }
        const url = page.url();
        await first.click();
        await page.getByRole("dialog", { name: "Fictional first watch", exact: true })
          .getByRole("link", { name: "Source record · FICTIONAL-ZONES", exact: true }).click();
        await expect(page.getByRole("article", { name: "Selected message" })).toContainText("FICTIONAL-ZONES");
        await page.reload();
        await page.getByRole("link", { name: "Return to Calendar", exact: true }).click();
        await expect(page).toHaveURL(url);
        await expect(page.getByRole("button", { name: "Week", exact: true })).toHaveAttribute("aria-pressed", "true");
        await expect(page.getByLabel("Grid interval")).toHaveValue("30");
        await page.getByRole("button", { name: "Next week", exact: true }).click();
        await expect(page.getByLabel("Local date", { exact: true })).toHaveValue("2026-11-11");
        await page.getByRole("button", { name: "Previous week", exact: true }).click();
        await page.getByRole("button", { name: "Today", exact: true }).click();
        await expect(page.getByLabel("Local date", { exact: true })).toHaveValue("2026-11-04");
        await page.getByLabel("Local date", { exact: true }).fill("2026-03-11");
        await expect(calendarEvent(page, "Fictional spring watch")).toBeVisible();
        if (timezoneId === "America/New_York") {
          expect(await calendarEvent(page, "Fictional spring watch").evaluate((el) => parseFloat((el.closest(".rbc-event") as HTMLElement).style.top))).toBeCloseTo(100 * 1.5 / 23, 1);
        }
        await page.getByLabel("Local date", { exact: true }).fill("2027-01-01");
        await expect(calendarEvent(page, "Fictional year crossing").first()).toBeVisible();
        await page.getByRole("button", { name: "Month", exact: true }).click();
        await expect(page).toHaveURL(/view=month/);
        await expect(page.getByRole("button", { name: "Month", exact: true })).toHaveAttribute("aria-pressed", "true");
        await page.getByRole("button", { name: "Day", exact: true }).click();
        await expect(page).toHaveURL(/view=day/);
        await expect(page.getByRole("button", { name: "Day", exact: true })).toHaveAttribute("aria-pressed", "true");
        await expect(page.getByLabel("Local date", { exact: true })).toHaveValue("2027-01-01");
        await page.getByRole("button", { name: "Week", exact: true }).click();
        await expect(page).toHaveURL(/view=week/);
        await expect(page.getByRole("button", { name: "Week", exact: true })).toHaveAttribute("aria-pressed", "true");
        await page.getByLabel("Local date", { exact: true }).fill("2026-11-04");
        await expect(page.getByRole("heading", { name: /01 Nov 2026 – 07 Nov 2026/ })).toBeVisible();
        await expectCalendarSections(page);
        await calendarEvent(page, "Fictional first watch").scrollIntoViewIfNeeded();
        await page.emulateMedia({ colorScheme: "light" });
        await stack.screenshot({ page, deliverable: true, name: `journey-${timezoneId.replaceAll("/", "-")}-desktop` });
        await page.setViewportSize({ width: 390, height: 844 });
        await page.emulateMedia({ colorScheme: "dark" });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        const scroll = page.getByRole("region", { name: /calendar, scrollable/ });
        await scroll.scrollIntoViewIfNeeded();
        await scroll.focus();
        await page.keyboard.press("ArrowRight");
        await expect.poll(() => scroll.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
        await stack.screenshot({ page, deliverable: true, name: `journey-${timezoneId.replaceAll("/", "-")}-narrow` });
        await page.setViewportSize({ width: 1440, height: 1100 });
        await page.emulateMedia({ colorScheme: "light" });
        await stack.screenshot({ page, deliverable: true });
        await stack.assertNoServerErrors();
      } finally { await stack.teardown(); }
    });
  });
}
