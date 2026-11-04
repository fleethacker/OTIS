import { test, expect } from "@playwright/test";
import { withEphemeralStack } from "../../../ark/pipeline/journey-stack";

test("Week fits the desktop and discloses short overlapping events", async ({ page }) => {
  const stack = await withEphemeralStack({ fixture: "fixtures/fit-week-calendar-to-screen.json", storyId: "fit-week-calendar-to-screen" });
  try {
    await page.clock.setFixedTime(new Date("2026-11-04T12:00:00Z"));
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto(stack.url);
    await page.getByRole("button", { name: "Week", exact: true }).click();
    await page.getByLabel("UTC date", { exact: true }).fill("2026-11-04");
    await expect(page.getByRole("button", { name: /Events in window/ })).toBeVisible();
    for (const size of [{ width: 1280, height: 800 }, { width: 1440, height: 900 }]) {
      await page.setViewportSize(size);
      for (const hours of ["0-24", "6-12"]) {
        await page.getByLabel("Visible hours (UTC)").selectOption(hours);
        for (const interval of ["30", "60"]) {
          await page.getByLabel("Grid interval").selectOption(interval);
          await page.evaluate(() => window.scrollTo(0, 0));
          await expect.poll(() => page.locator(".timeline-section").evaluate(el => el.getBoundingClientRect().bottom)).toBeLessThanOrEqual(size.height);
          for (const selector of [".week-scroll", ".ship-calendar-week", ".rbc-time-content"]) {
            await expect.poll(() => page.locator(selector).evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
            await expect.poll(() => page.locator(selector).evaluate(el => el.scrollHeight - el.clientHeight), { message: `${selector} ${hours} ${interval} vertical fit` }).toBeLessThanOrEqual(1);
          }
          await expect(page.locator(".rbc-time-header .rbc-header")).toHaveCount(7);
          await expect(page.locator(".preview-notice")).toBeInViewport();
        }
      }
    }
    await page.getByLabel("Visible hours (UTC)").selectOption("0-24");
    const shortBar = page.getByRole("button", { name: "Fictional one minute, event details", exact: true });
    const proportions = await shortBar.evaluate(el => {
      const box = el.closest(".rbc-event")!.getBoundingClientRect();
      const column = el.closest(".rbc-day-slot")!.getBoundingClientRect();
      return { top: (box.top - column.top) / column.height, height: box.height / column.height };
    });
    expect(proportions.top).toBeCloseTo((5 * 60 + 35) / 1440, 2);
    expect(proportions.height).toBeCloseTo(1 / 1440, 2);
    for (const title of ["Fictional one minute", "Fictional dense Alpha", "Fictional dense Bravo", "Fictional dense Charlie", "Fictional dense Delta", "Fictional continuing watch"]) {
      await page.getByRole("button", { name: /Events in window/ }).click();
      await page.getByRole("dialog").getByRole("button", { name: new RegExp(title) }).click();
      await expect(page.getByRole("dialog").getByRole("heading")).toHaveText(title);
      await expect(page.getByRole("dialog").getByRole("link", { name: /Source record/ })).toHaveAttribute("href", /record=FICTIONAL-ZONES/);
      if (title === "Fictional continuing watch") {
        await expect(page.getByRole("dialog")).toContainText("Continues from earlier");
        await expect(page.getByRole("dialog")).toContainText("Continues later");
        await expect(page.getByRole("dialog")).toContainText("2026-10-31 23:00 UTC");
      }
      await page.keyboard.press("Escape");
    }
    const event = page.getByRole("button", { name: "Fictional first watch, event details", exact: true });
    await event.focus();
    await page.keyboard.press("Enter");
    const detail = page.getByRole("dialog");
    await expect(detail).toContainText("2026-11-01 05:30 UTC");
    await expect(detail).toContainText("2026-11-01 05:45 UTC");
    await expect(detail).toContainText("Revised");
    await expect(detail).toContainText("USS Meridian");
    await expect(detail).toContainText("2026-11-01 05:15 UTC");
    await page.keyboard.press("Escape");
    await expect(event).toBeFocused();
    await page.getByRole("button", { name: /Events in window/ }).click();
    await detail.getByRole("button", { name: /Fictional overlap/ }).click();
    await expect(detail).toContainText("2026-11-01 05:35 UTC");
    const url = page.url();
    await detail.getByRole("link", { name: /Source record/ }).click();
    await expect(page.getByRole("article", { name: "Selected message" })).toContainText("FICTIONAL-ZONES");
    await page.reload();
    await page.getByRole("link", { name: "Return to Calendar", exact: true }).click();
    await expect(page).toHaveURL(url);
    await page.getByLabel("Week layout").selectOption("expanded");
    await expect(page.locator(".week-scroll")).toHaveClass(/week-expanded/);
    expect(await page.locator(".ship-calendar-week").evaluate(el => el.getBoundingClientRect().height)).toBeGreaterThan(900);
    await page.getByLabel("Week layout").selectOption("fit");
    await page.evaluate(() => window.scrollTo(0, 0));
    await stack.screenshot({ page, deliverable: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: "dark" });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const scroll = page.locator(".week-scroll");
    await scroll.scrollIntoViewIfNeeded();
    await scroll.focus();
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => scroll.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
    await stack.screenshot({ page, deliverable: true, name: "journey-narrow" });
    await page.getByRole("button", { name: /Events in window/ }).click();
    await detail.getByRole("button", { name: /Fictional first watch/ }).click();
    await expect(detail.getByRole("link", { name: /Source record/ })).toBeVisible();
    await stack.screenshot({ page, deliverable: true, name: "journey-details" });
    await page.keyboard.press("Escape");
    await expect(detail).not.toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 0));
    await stack.screenshot({ page, deliverable: true, name: "journey-narrow-controls" });
    await stack.assertNoServerErrors();
  } finally { await stack.teardown(); }
});
