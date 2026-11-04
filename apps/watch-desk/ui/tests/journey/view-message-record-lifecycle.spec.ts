import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { withEphemeralStack } from "../../../ark/pipeline/journey-stack";

test("inspect source-owned lifecycle without acknowledging a saved draft", async ({ page }) => {
  const stack = await withEphemeralStack({
    fixture: "fixtures/view-message-record-lifecycle.json",
    storyId: "view-message-record-lifecycle",
  });
  try {
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.emulateMedia({ colorScheme: "light" });
    const returnTo = "/calendar?date=2026-11-04&view=month&q=watch";
    // direct-url: cold reader links must retain the opaque Calendar destination.
    await page.goto(
      `${stack.url}/messages?record=FICTIONAL-LIFECYCLE-001&returnTo=${encodeURIComponent(returnTo)}`,
    );
    const reader = page.getByRole("article", { name: "Selected message" });
    const tabs = reader.getByRole("tab");
    const panel = reader.getByRole("tabpanel");
    await expect(tabs).toHaveText(["Parsed fields", "Raw message", "Lifecycle"]);
    await expect(tabs.nth(0)).toHaveAttribute("aria-selected", "true");
    await expect(panel.getByRole("heading", { name: "Fictional briefing" })).toBeVisible();
    await tabs.nth(0).focus();
    for (const [key, index] of [
      ["ArrowRight", 1],
      ["ArrowRight", 2],
      ["ArrowRight", 0],
      ["ArrowLeft", 2],
      ["Home", 0],
      ["End", 2],
    ] as const) {
      await page.keyboard.press(key);
      await expect(tabs.nth(index)).toBeFocused();
      await expect(tabs.nth(index)).toHaveAttribute("aria-selected", "true");
      await expect(tabs.nth(index)).toHaveAttribute("tabindex", "0");
      await expect(panel).toHaveAttribute(
        "id",
        (await tabs.nth(index).getAttribute("aria-controls"))!,
      );
      await expect(panel).toHaveAttribute(
        "aria-labelledby",
        (await tabs.nth(index).getAttribute("id"))!,
      );
      expect(new URL(page.url()).searchParams.get("record")).toBe("FICTIONAL-LIFECYCLE-001");
    }
    await expect(panel.getByRole("listitem")).toHaveCount(4);
    await expect(panel).toContainText("Fictional receipt evidence");
    await expect(panel).toContainText("2026-11-04 23:58 UTC");
    await expect(panel).toContainText("2026-11-05 00:01 UTC");
    await expect(panel).toContainText("Fictional external acknowledgement, not a saved draft");
    await expect(panel.getByRole("heading", { name: "Fictional briefing" })).toHaveCount(0);
    await reader.scrollIntoViewIfNeeded();
    await stack.screenshot({ page, deliverable: true });

    await page.getByRole("button", { name: /FICTIONAL-LIFECYCLE-002/ }).click();
    await expect(tabs.nth(0)).toHaveAttribute("aria-selected", "true");
    const editor = page.getByRole("textbox", { name: "Acknowledgement text" });
    await editor.fill("Private fictional draft, not an acknowledgement milestone.");
    await tabs.nth(1).click();
    await expect(panel).toContainText("FICTIONAL / ILLUSTRATIVE ONLY");
    await tabs.nth(2).click();
    await expect(editor).toHaveValue("Private fictional draft, not an acknowledgement milestone.");
    const entries = panel.getByRole("listitem");
    await expect(entries).toHaveCount(5);
    await expect(entries.nth(1)).toContainText("Fictional first parse");
    await expect(entries.nth(2)).toContainText("Fictional tied ingestion");
    await expect(entries.nth(3)).toContainText("Fictional second parse");
    await expect(entries.nth(4)).toContainText("Fictional undated review");
    await expect(entries.nth(4)).toContainText(/time unavailable/i);
    await expect(panel).toContainText(/partial|incomplete/i);
    await expect(panel).not.toContainText("Fictional receipt evidence");
    const upstream = panel.locator(".message-lifecycle");
    await expect(upstream).not.toContainText("Acknowledged");
    await expect(panel).toContainText("Not recorded as acknowledged in personal tracking");
    const beforeSave = (await upstream.textContent())!;
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(page.getByText("Saved · Unsent", { exact: true })).toBeVisible();
    await expect(upstream).toHaveText(beforeSave);
    await expect(reader.getByText("Updated", { exact: true })).toBeVisible();
    const sourceRead = page.waitForResponse(
      (response) =>
        response.url().endsWith("/app.v1.SourceDataService/ReadSchedules") && response.ok(),
    );
    await page.reload();
    const sharedSource = await (await sourceRead).json();
    expect(sharedSource.messages).toHaveLength(4);
    expect(JSON.stringify(sharedSource)).not.toContain("Private fictional draft");
    expect(
      sharedSource.messages.every((message: { drafts?: unknown[] }) => !message.drafts?.length),
    ).toBe(true);
    await expect(tabs.nth(0)).toHaveAttribute("aria-selected", "true");
    await expect(editor).toHaveValue("Private fictional draft, not an acknowledgement milestone.");
    await tabs.nth(2).click();
    await expect(upstream).toHaveText(beforeSave);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: "dark" });
    await panel.scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const accessibility = await new AxeBuilder({ page })
      .include(".message-reader")
      .withRules(["color-contrast", "aria-valid-attr-value", "aria-required-children"])
      .analyze();
    expect(accessibility.violations).toEqual([]);
    await stack.screenshot({ page, deliverable: true, name: "journey-mobile-dark" });

    await page.getByRole("button", { name: /FICTIONAL-LIFECYCLE-003/ }).click();
    await expect(tabs.nth(0)).toHaveAttribute("aria-selected", "true");
    await tabs.nth(2).click();
    await expect(panel).toContainText(/unavailable/i);
    await expect(panel.getByRole("listitem")).toHaveCount(0);
    await page.getByRole("button", { name: /FICTIONAL-LIFECYCLE-004/ }).click();
    await tabs.nth(2).click();
    await expect(panel.getByRole("listitem")).toHaveCount(1);
    await expect(panel).toContainText("Received");
    await expect(panel).not.toContainText("Parsed");
    await expect(page.getByRole("link", { name: "Return to Calendar" })).toHaveAttribute(
      "href",
      returnTo,
    );
    await page.getByRole("link", { name: "Return to Calendar" }).click();
    await expect(page).toHaveURL(`${stack.url}${returnTo}`);
    await stack.assertNoServerErrors();
  } finally {
    await stack.teardown();
  }
});
