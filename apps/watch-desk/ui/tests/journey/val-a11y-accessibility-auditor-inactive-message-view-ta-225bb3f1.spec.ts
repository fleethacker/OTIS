import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { withEphemeralStack } from "../../../ark/pipeline/journey-stack";

test("message view labels retain contrast in either selection and theme", async ({ page }) => {
  const stack = await withEphemeralStack({
    fixture: "fixtures/inspect-message-records.json",
    storyId: "val-a11y-accessibility-auditor-inactive-message-view-ta-225bb3f1",
  });
  try {
    await page.goto(stack.url);
    await page.getByRole("link", { name: "Message records", exact: true }).click();
    await page.getByRole("button", { name: /FICTIONAL-MERIDIAN-001/ }).click();
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const colorScheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme });
        for (const name of ["Parsed fields", "Raw message", "Lifecycle"]) {
          const selected = page.getByRole("tab", { name, exact: true });
          await selected.click();
          await expect(selected).toHaveAttribute("aria-selected", "true");
          const results = await new AxeBuilder({ page })
            .include('.message-reader [role="tablist"]')
            .withRules(["color-contrast"])
            .analyze();
          expect(results.violations, `${width} ${colorScheme} ${name}`).toEqual([]);
          expect(results.incomplete, "contrast must be measurable").toEqual([]);
        }
        await stack.screenshot({
          page,
          deliverable: true,
          ...(width === 1440 && colorScheme === "light"
            ? {}
            : { name: `journey-${width}-${colorScheme}` }),
        });
      }
    }
    await stack.assertNoServerErrors();
  } finally {
    await stack.teardown();
  }
});
