import { test, expect } from "@playwright/test";
import { withEphemeralStack } from "../../../ark/pipeline/journey-stack";
import { calendarEvent } from "./calendar-assertions";

test("watchstander orients, inspects a record reference and returns", async ({ page }) => {
  const stack = await withEphemeralStack({ fixture: "fixtures/read-the-daily-ship-schedule.json", storyId: "val-journey-83850376" });
  try {
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto(stack.url);
    await expect(page.getByRole("heading", { name: "Calendar", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Calendar", exact: true })).toHaveAttribute("aria-current", "page");
    // Use a fixed fixture date rather than the runner's current UTC date.
    await page.getByLabel("UTC date", { exact: true }).fill("2026-11-04");
    await page.getByRole("combobox", { name: /^Grid interval/ }).selectOption("30");
    await expect(page).toHaveURL(/interval=30/);
    await expect(calendarEvent(page, "Fictional night watch")).toBeVisible();
    const calendarURL = page.url();
    const account = page.getByRole("button", { name: "Account menu" });
    await account.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("menu", { name: "Account", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(account).toBeFocused();
    await calendarEvent(page, "Fictional night watch").click();
    const reader = page.getByRole("article", { name: "Selected message" });
    await expect(reader.getByRole("heading", { name: "Fictional Meridian overnight watches" })).toBeVisible();
    await page.reload();
    await expect(reader.getByRole("heading", { name: "Fictional Meridian overnight watches" })).toBeVisible();
    await page.getByRole("link", { name: "Return to Calendar" }).click();
    await expect(page).toHaveURL(calendarURL);
    await page.getByRole("link", { name: "Message records", exact: true }).click();
    await expect(page.getByRole("link", { name: "Message records", exact: true })).toHaveAttribute("aria-current", "page");
    await page.getByRole("link", { name: "Calendar", exact: true }).click();
    await page.getByLabel("UTC date", { exact: true }).fill("2026-11-04");
    await expect(page.getByRole("heading", { name: "Calendar", exact: true })).toBeVisible();
    await stack.screenshot({ page, deliverable: true });
    await page.emulateMedia({ colorScheme: "dark" });
    await stack.screenshot({ page, deliverable: true, name: "journey-desktop-dark" });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole("heading", { name: "Calendar", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const timeline = page.getByRole("region", { name: "Zulu UTC calendar, scrollable" });
    await timeline.focus();
    await page.keyboard.press("ArrowRight");
    await page.evaluate(() => window.scrollTo(0, 0));
    await stack.screenshot({ page, deliverable: true, name: "journey-mobile-dark" });
    await page.emulateMedia({ colorScheme: "light" });
    await stack.screenshot({ page, deliverable: true, name: "journey-mobile-light" });
    await account.scrollIntoViewIfNeeded();
    await account.click();
    await page.route("**/logout", route => route.fulfill({ status: 200, contentType: "text/html", body: "Signed out boundary" }));
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/logout$/);
    await stack.assertNoServerErrors();
  } finally { await stack.teardown(); }
});
