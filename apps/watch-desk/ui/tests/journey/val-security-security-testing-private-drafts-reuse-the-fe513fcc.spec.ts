import { test, expect } from "@playwright/test";
import { withEphemeralStack } from "../../../ark/pipeline/journey-stack";

test("private drafts reset on session signals and remain hidden during verification", async ({ page }) => {
  const stack = await withEphemeralStack({
    fixture: "fixtures/val-security-security-testing-private-drafts-reuse-the-fe513fcc.json",
    storyId: "val-security-security-testing-private-drafts-reuse-the-fe513fcc",
  });
  try {
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto(stack.url);
    await page.getByRole("link", { name: "Message records", exact: true }).click();
    await page.getByRole("button", { name: /FICTIONAL-DRAFT-001/ }).click();
    const editor = page.getByRole("textbox", { name: "Acknowledgement text" });
    await expect(editor).toHaveValue("");
    await editor.fill("Saved private acknowledgement");
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(page.getByText("Saved · Unsent", { exact: true })).toBeVisible({ timeout: 2000 });
    await editor.fill("Unsaved text must not survive a session change");
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    await page.route("**/app.v1.AppService/GetIdentity", async (route) => {
      await held;
      await route.continue();
    });
    await page.evaluate(() => window.dispatchEvent(new MessageEvent("message", { data: { type: "ark-auth-changed" } })));
    await expect(page.getByText("Private preparation hidden while account verification is unavailable.")).toBeVisible();
    await expect(editor).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Save draft", exact: true })).toHaveCount(0);
    release();
    await expect(editor).toHaveValue("Saved private acknowledgement");
    await page.unroute("**/app.v1.AppService/GetIdentity");
    await stack.assertNoServerErrors();
    await stack.screenshot({ page, deliverable: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: "dark" });
    await editor.scrollIntoViewIfNeeded();
    await stack.screenshot({ page, deliverable: true, name: "journey-mobile-dark" });
  } finally {
    await stack.teardown();
  }
});
