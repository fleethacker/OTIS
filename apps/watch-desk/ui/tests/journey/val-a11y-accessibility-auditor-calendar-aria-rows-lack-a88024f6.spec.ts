import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { withEphemeralStack } from "../../../ark/pipeline/journey-stack";

test("whole calendar has valid ARIA hierarchy and operable dates and sources", async ({ page }) => {
  const stack = await withEphemeralStack({
    fixture: "fixtures/read-the-daily-ship-schedule.json",
    storyId: "val-a11y-accessibility-auditor-calendar-aria-rows-lack-a88024f6",
  });
  try {
    await page.goto(stack.url);
    await page.getByLabel("UTC date", { exact: true }).fill("2026-11-04");
    const calendar = page.getByRole("region", { name: "Zulu UTC calendar, scrollable" });
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const colorScheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme });
        for (const view of ["Day", "Week", "Month"]) {
          await page.getByRole("button", { name: view, exact: true }).click();
          await expect(calendar.getByRole("link", { name: "Fictional crew briefing, source record", exact: true })).toBeVisible();
          const results = await new AxeBuilder({ page }).include(".calendar-scroll")
            .withRules(["aria-required-children", "aria-required-parent", "aria-roles", "aria-valid-attr-value"])
            .analyze();
          expect(results.violations, `${width} ${colorScheme} ${view}`).toEqual([]);
        }
        await stack.screenshot({ page, deliverable: true,
          ...(width === 1440 && colorScheme === "light" ? {} : { name: `journey-${width}-${colorScheme}` }) });
      }
    }
    const date = calendar.getByRole("button", { name: "Open 2026-11-04 in Day view" });
    await date.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Day", exact: true })).toHaveAttribute("aria-pressed", "true");
    const source = calendar.getByRole("link", { name: "Fictional crew briefing, source record", exact: true });
    await source.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("article", { name: "Selected message" })).toContainText("FICTIONAL-MERIDIAN-001");
    await page.getByRole("link", { name: "Return to Calendar", exact: true }).click();
    await expect(calendar).toBeVisible();
    // A completely empty all-day layout must not acquire row requirements either.
    await page.getByLabel("UTC date", { exact: true }).fill("2027-02-04");
    await expect(page).toHaveURL(/date=2027-02-04/);
    for (const view of ["Day", "Week", "Month"]) {
      await page.getByRole("button", { name: view, exact: true }).click();
      await expect(calendar).toBeVisible();
      await expect(calendar.getByRole("link")).toHaveCount(0);
      const results = await new AxeBuilder({ page }).include(".calendar-scroll")
        .withRules(["aria-required-children", "aria-required-parent"]).analyze();
      expect(results.violations).toEqual([]);
    }
    await stack.assertNoServerErrors();
  } finally {
    await stack.teardown();
  }
});
