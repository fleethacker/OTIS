import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { withEphemeralStack } from "../../../ark/pipeline/journey-stack";

test("Day links and Week disclosures provide keyboard-operable source access", async ({ page }) => {
  const stack = await withEphemeralStack({
    fixture: "fixtures/read-the-daily-ship-schedule.json",
    storyId: "val-a11y-accessibility-auditor-day-and-week-calendar-ev-a5d3a692",
  });
  try {
    await page.goto(stack.url);
    await page.getByLabel("UTC date", { exact: true }).fill("2026-11-04");
    const calendar = page.getByRole("region", { name: "Zulu UTC calendar, scrollable" });
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const colorScheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme });
        for (const view of ["Day", "Week"] as const) {
          await page.getByRole("button", { name: view, exact: true }).click();
          const role = view === "Week" ? "button" : "link";
          const suffix = view === "Week" ? "event details" : "source record";
          const source = calendar.getByRole(role, { name: `Fictional crew briefing, ${suffix}`, exact: true });
          const revised = calendar.getByRole(role, { name: `Fictional revised replenishment, ${suffix}`, exact: true });
          await expect(source).toBeVisible();
          await expect(revised).toContainText("Revised");
          if (view === "Day") {
            await expect(revised).toContainText("2026-11-04 14:00 UTC");
          }
          // Scan the whole page, including every timed/all-day/revised event.
          const results = await new AxeBuilder({ page }).withRules(["nested-interactive"]).analyze();
          expect(results.violations, `${width} ${colorScheme} ${view}`).toEqual([]);
          await expect(calendar.locator('[role="button"] a')).toHaveCount(0);
          for (const [link, record] of [[source, "FICTIONAL-MERIDIAN-001"], [revised, "FICTIONAL-MERIDIAN-004"]] as const) {
            const returnUrl = page.url();
            await link.focus();
            await page.keyboard.press("Tab");
            await page.keyboard.press("Shift+Tab");
            await expect(link).toBeFocused();
            await page.keyboard.press("Enter");
            if (view === "Week") {
              const details = page.getByRole("dialog");
              await expect(details).toBeVisible();
              if (record === "FICTIONAL-MERIDIAN-004") {
                await expect(details).toContainText("2026-11-04 14:00 UTC");
                await expect(details).toContainText("Prior:");
              }
              const disclosureResults = await new AxeBuilder({ page }).withRules(["nested-interactive"]).analyze();
              expect(disclosureResults.violations).toEqual([]);
              const sourceLink = details.getByRole("link", { name: `Source record · ${record}`, exact: true });
              await sourceLink.focus();
              await page.keyboard.press("Enter");
            }
            await expect(page.getByRole("article", { name: "Selected message" })).toContainText(record);
            await page.getByRole("link", { name: "Return to Calendar", exact: true }).click();
            await expect(page).toHaveURL(returnUrl);
          }
          await source.focus();
          await stack.screenshot({
            page,
            deliverable: true,
            ...(width === 1440 && colorScheme === "light" && view === "Day"
              ? {}
              : { name: `journey-${width}-${colorScheme}-${view.toLowerCase()}` }),
          });
        }
      }
    }
    await stack.assertNoServerErrors();
  } finally {
    await stack.teardown();
  }
});
