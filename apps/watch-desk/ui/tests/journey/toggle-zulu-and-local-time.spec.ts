import { test, expect } from "@playwright/test";
import { withEphemeralStack } from "../../../ark/pipeline/journey-stack";
import { calendarEvent, expectDayGeometry, expectCalendarSections } from "./calendar-assertions";

for (const timezoneId of ["UTC", "America/New_York", "Asia/Kathmandu"]) {
  test.describe(timezoneId, () => {
    test.use({ timezoneId });
    test("display zone changes real projection and survives source inspection", async ({ page }) => {
      const stack = await withEphemeralStack({ fixture: "fixtures/toggle-zulu-and-local-time.json", storyId: "toggle-zulu-and-local-time" });
      try {
        await page.clock.setFixedTime(new Date("2026-11-01T00:30:00Z"));
        await page.setViewportSize({ width: 1440, height: 1100 });
        await page.goto(stack.url);
        const utc = page.getByRole("button", { name: "Zulu / UTC", exact: true });
        const local = page.getByRole("button", { name: "Local", exact: true });
        await expect(utc).toHaveAttribute("aria-pressed", "true");
        await page.getByLabel("UTC date", { exact: true }).fill("2026-11-01");
        await page.getByLabel("Grid interval").selectOption("30");
        await page.getByRole("searchbox").fill("fictional");
        await expectDayGeometry(page, "Fictional first watch", 5.5 / 24, 0.25 / 24);
        const civilURL = page.url();
        await local.focus();
        await page.keyboard.press("Enter");
        await expect(local).toHaveAttribute("aria-pressed", "true");
        await expect(page).toHaveURL(civilURL);
        await expect(page.getByLabel("Local date", { exact: true })).toHaveValue("2026-11-01");
        const browserZone = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
        await expect(page.getByText(`Local · ${browserZone}`, { exact: true }).first()).toBeVisible();
        const offset = timezoneId === "America/New_York" ? "-04:00" : timezoneId === "Asia/Kathmandu" ? "+05:45" : "+00:00";
        await expect(calendarEvent(page, "Fictional first watch")).toContainText(`UTC${offset}`);
        const top = timezoneId === "America/New_York" ? 1.5 / 25 : timezoneId === "Asia/Kathmandu" ? 11.25 / 24 : 5.5 / 24;
        await expectDayGeometry(page, "Fictional first watch", top, 0.25 / (timezoneId === "America/New_York" ? 25 : 24));
        if (timezoneId === "America/New_York") {
          await expectDayGeometry(page, "Fictional second watch", 2.5 / 25, 0.25 / 25);
          const gutter = page.locator(".rbc-time-gutter");
          await expect(gutter).toContainText("01:30 UTC-04:00");
          await expect(gutter).toContainText("01:30 UTC-05:00");
          await expect(calendarEvent(page, "Fictional second watch")).toContainText("01:30:00 UTC-05:00");
          await expectDayGeometry(page, "Fictional midnight watch", 24.5 / 25, 0.5 / 25);
          await page.getByLabel("Visible hours (Local)").selectOption("0-6");
          await expectDayGeometry(page, "Fictional second watch", 2.5 / 7, 0.25 / 7);
        }
        await expectCalendarSections(page);
        await expect(calendarEvent(page, "Fictional unresolved watch")).toHaveCount(0);
        const url = page.url();
        await calendarEvent(page, "Fictional first watch").click();
        const reader = page.getByRole("article", { name: "Selected message" });
        await expect(reader).toContainText(`UTC${offset}`);
        await expect(reader).toContainText(timezoneId === "America/New_York" ? "Prior: 2026-11-01 01:15:00 UTC-04:00" : timezoneId === "Asia/Kathmandu" ? "Prior: 2026-11-01 11:00:00 UTC+05:45" : "Prior: 2026-11-01 05:15:00 UTC+00:00");
        await page.getByRole("tab", { name: "Lifecycle", exact: true }).click();
        await expect(page.getByRole("region", { name: "Message lifecycle" })).toContainText(timezoneId === "America/New_York" ? "01:00:00 UTC-04:00" : timezoneId === "Asia/Kathmandu" ? "10:45:00 UTC+05:45" : "05:00:00 UTC+00:00");
        await page.getByRole("tab", { name: "Raw message", exact: true }).click();
        const raw = await page.locator(".raw-lines code").allTextContents();
        await utc.click();
        await expect(page.locator(".raw-lines code")).toHaveText(raw);
        await expect(reader).toContainText("2026-11-01 05:30 UTC");
        await local.click();
        await page.reload();
        await expect(local).toHaveAttribute("aria-pressed", "true");
        await page.getByRole("link", { name: "Return to Calendar", exact: true }).click();
        await expect(page).toHaveURL(url);
        await expect(page.getByLabel("Grid interval")).toHaveValue("30");
        await expect(page.getByRole("searchbox")).toHaveValue("fictional");
        await page.getByLabel("Visible hours (Local)").selectOption("0-24");
        await expect(page).toHaveURL(/hours=0-24/);
        if (timezoneId === "America/New_York") {
          await page.getByLabel("Local date", { exact: true }).fill("2026-03-08");
          await expectDayGeometry(page, "Fictional spring watch", 1.5 / 23, 2 / 23);
          await expect(page.locator(".rbc-time-gutter")).not.toContainText("02:00");
          await page.getByRole("button", { name: "Next day", exact: true }).click();
          await expect(page.getByLabel("Local date", { exact: true })).toHaveValue("2026-03-09");
          await page.getByRole("button", { name: "Today", exact: true }).click();
          await expect(page.getByLabel("Local date", { exact: true })).toHaveValue("2026-10-31");
          await expect(page.locator(".rbc-current-time-indicator")).toHaveCount(1);
          expect(await page.locator(".rbc-current-time-indicator").evaluate((element) => parseFloat((element as HTMLElement).style.top))).toBeCloseTo(100 * 20.5 / 24, 1);
        }
        await page.getByLabel("Local date", { exact: true }).fill("2026-12-31");
        await page.getByRole("button", { name: "Month", exact: true }).click();
        const monthURL = page.url();
        await utc.click();
        await expect(page).toHaveURL(monthURL);
        await expect(page.getByRole("button", { name: "Month", exact: true })).toHaveAttribute("aria-pressed", "true");
        await local.click();
        await page.getByRole("button", { name: "Next month", exact: true }).click();
        await expect(page.getByLabel("Local date", { exact: true })).toHaveValue("2027-01-01");
        await expect(calendarEvent(page, "Fictional year crossing", ".rbc-month-view").first()).toBeVisible();
        await page.getByRole("button", { name: "Open 2027-01-01 in Day view", exact: true }).click();
        await expect(page.getByRole("button", { name: "Day", exact: true })).toHaveAttribute("aria-pressed", "true");
        await page.getByLabel("Local date", { exact: true }).fill("2026-11-01");
        await page.emulateMedia({ colorScheme: "light" });
        await stack.screenshot({ page, deliverable: true, name: `journey-${timezoneId.replaceAll("/", "-")}-desktop-local` });
        await page.locator(".calendar-scroll").scrollIntoViewIfNeeded();
        await stack.screenshot({ page, deliverable: true, name: `journey-${timezoneId.replaceAll("/", "-")}-grid-local` });
        await page.setViewportSize({ width: 390, height: 844 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.emulateMedia({ colorScheme: "dark" });
        await stack.screenshot({ page, deliverable: true, name: `journey-${timezoneId.replaceAll("/", "-")}-mobile-local` });
        await page.locator(".calendar-scroll").scrollIntoViewIfNeeded();
        await stack.screenshot({ page, deliverable: true, name: `journey-${timezoneId.replaceAll("/", "-")}-mobile-grid-local` });
        await utc.click();
        await stack.screenshot({ page, deliverable: true, name: `journey-${timezoneId.replaceAll("/", "-")}-mobile-utc` });
        await page.setViewportSize({ width: 1440, height: 1100 });
        await stack.screenshot({ page, deliverable: true });
        await stack.assertNoServerErrors();
      } finally { await stack.teardown(); }
    });
  });
}

test("denied preference storage remains usable in memory", async ({ page }) => {
  const stack = await withEphemeralStack({ fixture: "fixtures/toggle-zulu-and-local-time.json", storyId: "toggle-zulu-and-local-time" });
  try {
    await page.addInitScript(() => {
      const originalGet = Storage.prototype.getItem;
      const originalSet = Storage.prototype.setItem;
      Storage.prototype.getItem = function(key) { if (key === "watch-desk-display-time") { throw new Error("denied"); } return originalGet.call(this, key); };
      Storage.prototype.setItem = function(key, value) { if (key === "watch-desk-display-time") { throw new Error("denied"); } return originalSet.call(this, key, value); };
    });
    await page.goto(stack.url);
    await page.getByRole("button", { name: "Local", exact: true }).click();
    await page.getByRole("link", { name: "Message records", exact: true }).click();
    await expect(page.getByRole("button", { name: "Local", exact: true })).toHaveAttribute("aria-pressed", "true");
    await page.reload();
    await expect(page.getByRole("button", { name: "Zulu / UTC", exact: true })).toHaveAttribute("aria-pressed", "true");
    await stack.assertNoServerErrors();
  } finally { await stack.teardown(); }
});
