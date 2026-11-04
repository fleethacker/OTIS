import { test, expect } from "@playwright/test";
import { withEphemeralStack } from "../../../ark/pipeline/journey-stack";

test("search and inspect traceable messages across screens", async ({ page }) => {
  const stack = await withEphemeralStack({ fixture: "fixtures/inspect-message-records.json", storyId: "inspect-message-records" });
  try {
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto(stack.url);
    await page.getByRole("link", { name: "Message records", exact: true }).click();
    const search = page.getByRole("searchbox", { name: "Search Message records" });
    await search.focus();
    await page.keyboard.type("Wardroom");
    await expect(page.getByRole("heading", { name: "1 matching records" })).toBeVisible();
    await page.getByRole("button", { name: /FICTIONAL-MERIDIAN-001/ }).click();
    const reader = page.getByRole("article", { name: "Selected message" });
    await expect(reader.getByText(/Illustrative syntax, not validated USMTF/)).toBeVisible();
    await page.getByRole("tab", { name: "Raw message", exact: true }).click();
    await expect(reader.getByText("Time / Location", { exact: true }).first()).toBeVisible();
    await page.reload();
    await expect(reader.getByRole("heading", { name: "Fictional Meridian daily activities" })).toBeVisible();
    await page.getByRole("tab", { name: "Parsed fields" }).click();
    await expect(reader.getByRole("heading", { name: "Fictional equipment check" })).toBeVisible();
    await expect(reader.getByRole("heading", { name: "Fictional departure" })).toBeVisible();
    await page.getByRole("button", { name: "Clear search" }).click();
    await page.getByRole("button", { name: /FICTIONAL-MERIDIAN-004/ }).click();
    await expect(reader.getByText(/Prior: 2026-11-04 13:00 UTC → Unavailable/)).toBeVisible();
    await expect(reader.getByRole("button", { name: "Summarize" })).toBeDisabled();
    await stack.screenshot({ page, deliverable: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.getByRole("button", { name: /FICTIONAL-MERIDIAN-005/ }).click();
    await expect(reader.getByText(/Needs review —/)).toBeVisible();
    await reader.scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await stack.screenshot({ page, deliverable: true, name: "journey-mobile-dark" });
    // direct-url: the reader contract explicitly supports cold links and opaque Calendar returns.
    await page.goto(`${stack.url}/messages?record=unknown&returnTo=${encodeURIComponent("/calendar?date=2026-11-04&view=month&q=watch")}`); // direct-url: verify cold message links with an opaque Calendar return.
    await expect(page.getByRole("heading", { name: "Message record not found" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Return to Calendar" })).toHaveAttribute("href", "/calendar?date=2026-11-04&view=month&q=watch");
    await page.route("**/app.v1.SourceDataService/ReadSchedules", route => route.fulfill({ status: 200, contentType: "application/json", body: '{"messages":[]}' }));
    await page.reload();
    await expect(page.getByRole("heading", { name: "No Message records available" })).toBeVisible();
    await page.unroute("**/app.v1.SourceDataService/ReadSchedules");
    await page.getByRole("button", { name: "Retry", exact: true }).first().click();
    await expect(page.getByRole("heading", { name: "5 matching records" })).toBeVisible();
    await stack.expectBrowserHTTPError({ path: "/app.v1.SourceDataService/ReadSchedules", status: 503, reason: "Verify reader outage and retry" });
    await page.route("**/app.v1.SourceDataService/ReadSchedules", route => route.fulfill({ status: 503, contentType: "application/json", body: '{"code":"unavailable","message":"Controlled outage"}' }));
    await page.reload();
    await expect(page.getByRole("alert")).toContainText("could not be loaded", { timeout: 15000 });
    await page.unroute("**/app.v1.SourceDataService/ReadSchedules");
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(page.getByRole("heading", { name: "5 matching records" })).toBeVisible();
    await stack.assertNoServerErrors();
  } finally { await stack.teardown(); }
});
