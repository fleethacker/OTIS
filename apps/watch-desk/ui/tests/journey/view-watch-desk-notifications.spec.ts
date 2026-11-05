import { test, expect } from "@playwright/test";
import { withEphemeralStack } from "../../../ark/pipeline/journey-stack";

// The exported journey harness serves the retained Go app. Stub only the new Rust
// transport here; durable read isolation/replay is covered by Rust integration tests.
test("compact notification inbox, grouped traffic and persistent read transport", async ({ page }) => {
  const stack = await withEphemeralStack({ fixture: "fixtures/view-watch-desk-notifications.json", storyId: "view-watch-desk-notifications" });
  const entries = [
    { id: 1, version: 2, kind: "traffic", count: 12, context: "", messageKey: "", at: "2026-11-04T22:30:00Z", detail: "", resolvedAt: null, unread: true },
    { id: 2, version: 1, kind: "failed", count: 1, context: "EXAMPLE · TRAINING", messageKey: "", at: "2026-11-04T22:20:00Z", detail: "Message storage failed", resolvedAt: null, unread: true },
  ];
  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.emulateMedia({ colorScheme: "light" });
    await page.route("**/api/v1/messages/*", route => route.fulfill({ json: { messages: [], meta: { totalRecords: 0, totalPages: 0 }, source: "fixture" } }));
    await page.route("**/api/v1/notifications/*", route => {
      const operation = new URL(route.request().url()).pathname.split("/").pop();
      const request = route.request().postDataJSON();
      if (operation === "read") {
        for (const entry of entries) if (request.through >= entry.version || request.id === entry.id) entry.unread = false;
        return route.fulfill({ json: { saved: true } });
      }
      if (operation === "members") return route.fulfill({ json: { items: [{ messageKey: "hidden-source-key", subject: "Exercise tasking", context: "EXAMPLE · TRAINING", at: entries[0].at, version: 2 }], nextBefore: null } });
      return route.fulfill({ json: { items: entries, unread: entries.filter(entry => entry.unread).length, watermark: 2, nextBefore: null, catchingUp: false } });
    });
    await page.goto(stack.url);
    const bell = page.getByRole("button", { name: /^Notifications/ });
    await bell.click();
    const panel = page.getByRole("region", { name: "Notifications", exact: true });
    await expect(bell).toHaveAccessibleName("Notifications, 2 unread");
    await expect(panel.getByText("04 NOV 2026 2230Z")).toBeVisible();
    await expect(panel).not.toContainText("Daily reminder");
    await expect(panel).not.toContainText("In-app only");
    await stack.screenshot({ page, deliverable: true });
    await panel.getByRole("button", { name: /^12 new messages received/ }).click();
    await expect(panel.getByRole("link", { name: /Exercise tasking/ })).toBeVisible();
    await expect(panel).not.toContainText("hidden-source-key");
    await expect(bell).toHaveAccessibleName("Notifications, 1 unread");
    await panel.getByRole("button", { name: "Back to notifications" }).click();
    await panel.getByRole("button", { name: /^Message ingestion failed EXAMPLE/ }).click();
    await expect(panel.getByText("Recovery pending")).toBeVisible();
    await expect(panel.getByText("Message storage failed")).toBeVisible();
    await expect(bell).toHaveAccessibleName("Notifications");
    await page.keyboard.press("Escape");
    await expect(bell).toBeFocused();
    await page.reload();
    await bell.click();
    await expect(bell).toHaveAccessibleName("Notifications");
    await expect(panel.getByRole("button", { name: "Mark all as read" })).toBeDisabled();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(panel).toBeVisible();
    expect(await panel.evaluate(element => { const rect = element.getBoundingClientRect(); return rect.left >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight; })).toBe(true);
    await stack.screenshot({ page, deliverable: true, name: "journey-mobile-dark" });
    await stack.assertNoServerErrors();
  } finally { await stack.teardown(); }
});
