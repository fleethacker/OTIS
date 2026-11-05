import { test, expect } from "@playwright/test";
import { withEphemeralStack } from "../../../ark/pipeline/journey-stack";
import { expectCalendarSections } from "./calendar-assertions";

test.use({ timezoneId: "America/New_York" });
test("inline search wraps and retains schedule context", async ({ page }) => {
  const stack = await withEphemeralStack({ fixture: "fixtures/find-upcoming-events-and-review-gaps.json", storyId: "align-calendar-search-and-controls" });
  try {
    await page.clock.setFixedTime(new Date("2026-11-04T07:00:00Z"));
    await page.setViewportSize({ width: 1600, height: 1100 });
    await page.goto(stack.url);
    const search = page.getByRole("searchbox", { name: "Search schedule" });
    const controls = page.getByRole("region", { name: "Calendar controls" });
    await expect(search).toHaveAttribute("aria-describedby", "schedule-search-hint");
    await expect(page.locator("#schedule-search-hint")).toBeVisible();
    const searchBox = await search.boundingBox();
    for (const control of await controls.locator("button, input, select").all()) {
      const box = (await control.boundingBox())!;
      expect(Math.abs(box.y + box.height - searchBox!.y - searchBox!.height)).toBeLessThan(2);
    }
    await search.focus();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Day", exact: true })).toBeFocused();
    await page.getByLabel("UTC date", { exact: true }).fill("2026-11-04");
    await search.fill("COPPER LANTERN");
    const upcoming = page.getByRole("region", { name: "Next upcoming events" });
    await expect(upcoming.getByRole("listitem")).toHaveCount(5);
    await page.getByRole("button", { name: "Month", exact: true }).click();
    await expect(page.getByLabel("Grid interval")).toBeDisabled();
    await expect(page.getByLabel("Visible hours (UTC)")).toBeDisabled();
    await page.getByRole("button", { name: "Next month", exact: true }).click();
    await page.getByRole("button", { name: "Previous month", exact: true }).click();
    await page.getByRole("button", { name: "Day", exact: true }).click();
    await page.getByRole("button", { name: "Today", exact: true }).click();
    await page.getByLabel("Grid interval").selectOption("30");
    await page.getByLabel("Visible hours (UTC)").selectOption("6-12");
    await page.getByRole("button", { name: "Local", exact: true }).click();
    const context = page.url();
    await upcoming.getByRole("link", { name: "Fictional equipment check", exact: true }).click();
    await page.reload();
    await page.getByRole("link", { name: "Return to Calendar", exact: true }).click();
    await expect(page).toHaveURL(context);
    await expect(search).toHaveValue("COPPER LANTERN");
    await expect(page.getByLabel("Grid interval")).toHaveValue("30");
    await expect(page.getByLabel("Visible hours (Local)")).toHaveValue("6-12");
    await expect(page.getByRole("button", { name: "Local", exact: true })).toHaveAttribute("aria-pressed", "true");
    await search.fill("pending coordination");
    await expect(page.getByRole("region", { name: "Needs review" })).toHaveCount(0);
    await expect(upcoming).toContainText("No upcoming timed events");
    await search.fill("");
    await expectCalendarSections(page);
    await page.emulateMedia({ colorScheme: "light" });
    await search.scrollIntoViewIfNeeded();
    await stack.screenshot({ page, deliverable: true });
    for (const width of [1024, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const mode of ["Zulu / UTC", "Local"]) {
        await page.getByRole("button", { name: mode, exact: true }).click();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        expect((await search.boundingBox())!.width).toBeGreaterThanOrEqual(240);
        const boxes = await controls.locator("button, input, select").evaluateAll(elements => elements.map(el => { const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, right: b.right, bottom: b.bottom }; }));
        for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i], b = boxes[j];
          expect(a.right <= b.x + 1 || b.right <= a.x + 1 || a.bottom <= b.y + 1 || b.bottom <= a.y + 1).toBe(true);
        }
        await page.emulateMedia({ colorScheme: mode === "Local" ? "dark" : "light" });
        await search.scrollIntoViewIfNeeded();
        await stack.screenshot({ page, deliverable: true, name: `journey-${width}-${mode === "Local" ? "local-dark" : "utc-light"}` });
      }
    }
    await stack.assertNoServerErrors();
  } finally { await stack.teardown(); }
});
