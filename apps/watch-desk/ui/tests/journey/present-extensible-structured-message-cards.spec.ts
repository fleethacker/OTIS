import { existsSync, readFileSync } from "node:fs";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { withEphemeralStack } from "../../../ark/pipeline/journey-stack";

const fixtureURL = new URL(
  "./fixtures/present-extensible-structured-message-cards.json",
  import.meta.url
);
const hasExternalReferences = existsSync(fixtureURL);
const fixture = (
  hasExternalReferences ? JSON.parse(readFileSync(fixtureURL, "utf8")) : { message_records: [] }
) as {
  message_records: { source_message_id: string; structured_payload_json?: string }[];
};
const references = fixture.message_records.slice(0, 14).map((record) => ({
  sourceId: record.source_message_id,
  payload: JSON.parse(record.structured_payload_json!),
}));

// Check supplied scalar data, not implementation-specific object/array markup.
function suppliedValues(value: unknown, key = ""): string[] {
  if (Array.isArray(value)) return value.flatMap((item) => suppliedValues(item, key));
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([name, item]) => suppliedValues(item, name));
  }
  if (typeof value === "string" && !/^\d{4}-\d\d-\d\dT/.test(value)) return [value];
  if (typeof value === "number")
    return [/^(?:upper_)?hz$/.test(key) ? `${value} Hz` : String(value)];
  if (typeof value === "boolean") return [String(value)];
  return [];
}

test.use({ timezoneId: "America/New_York" });

test("inspect every attributed structured reference and preserve the legacy workflow", async ({
  page,
}) => {
  test.skip(
    !hasExternalReferences,
    "Optional external OPTASK references absent; see docs/integration/ark-export.md at the monorepo root"
  );
  test.setTimeout(180_000);
  const stack = await withEphemeralStack({
    fixture: "fixtures/present-extensible-structured-message-cards.json",
    storyId: "present-extensible-structured-message-cards",
  });
  try {
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.emulateMedia({ colorScheme: "light" });
    const returnTo = "/calendar?date=2026-11-04&view=month&q=watch";
    // direct-url: source selection and opaque Calendar return are public reader contracts.
    await page.goto(
      `${stack.url}/messages?record=${encodeURIComponent(references[0].sourceId)}&returnTo=${encodeURIComponent(returnTo)}`
    ); // direct-url: cold source selection must preserve Calendar return context
    const reader = page.getByRole("article", { name: "Selected message" });
    const panel = reader.getByRole("tabpanel");
    const tabs = reader.getByRole("tab");
    const search = page.getByRole("searchbox", { name: "Search Message records" });
    await expect(page.getByRole("heading", { name: "16 matching records" })).toBeVisible();
    await expect(tabs).toHaveText(["Parsed fields", "Raw message", "Lifecycle"]);

    for (const { sourceId, payload } of references) {
      await search.fill(payload.type);
      const choice = page.getByRole("button", {
        name: new RegExp(sourceId.replaceAll(".", "\\.")),
      });
      await expect(choice).toBeVisible();
      await choice.click();
      await expect(tabs.nth(0)).toHaveAttribute("aria-selected", "true");
      const title =
        payload.subject || `${payload.type}${payload.serial == null ? "" : ` · ${payload.serial}`}`;
      await expect(reader.getByRole("heading", { name: title, exact: true }).first()).toBeVisible();
      await expect(reader).toContainText(sourceId.replace("REFERENCE-", ""));
      await expect(reader).not.toContainText("Fictional USS Meridian");
      for (const heading of [
        "Message metadata",
        "Security metadata",
        "Review flags",
        "Periods",
        "Frequencies",
        "Activities",
        "Contacts",
      ]) {
        await expect(panel.getByRole("heading", { name: heading, exact: true })).toBeVisible();
      }
      for (const value of new Set(suppliedValues(payload))) {
        await expect(panel).toContainText(value);
      }
      await expect(reader.getByRole("button", { name: "Summarize", exact: true })).toBeDisabled();
      // Originator, serial and immutable payload ID remain searchable, not just the title.
      for (const query of [payload.originator, payload.serial, payload.id].filter(Boolean)) {
        await search.fill(query);
        await expect(choice).toBeVisible();
      }
      await tabs.nth(1).click();
      await expect(panel).toContainText("Raw message unavailable.");
      await expect(panel.locator(".raw-lines")).toHaveCount(0);
      await expect(panel).not.toContainText('"issued_at"');
      await tabs.nth(2).click();
      await expect(panel).toContainText("Lifecycle history unavailable.");
      await expect(panel.getByRole("listitem")).toHaveCount(0);
      await expect(panel.getByText("Received", { exact: true })).toHaveCount(0);
      await search.fill("");
    }

    await page.getByRole("button", { name: /REFERENCE-optask-comms\.txt/ }).click();
    await expect(panel).toContainText("2009-02-14 13:25");
    await expect(panel).toContainText("05:00Z");
    await expect(panel).toContainText("missing_date");
    await page.getByRole("button", { name: "Local", exact: true }).click();
    await expect(panel).toContainText("2009-02-14 08:25");
    await expect(panel).toContainText("UTC-05:00");
    await expect(panel).toContainText("05:00Z");
    await expect(panel).toContainText("missing_date");
    await page.getByRole("button", { name: "Zulu / UTC", exact: true }).click();
    await expect(panel).toContainText("2009-02-14 13:25");
    await reader.scrollIntoViewIfNeeded();
    await stack.screenshot({ page, deliverable: true });

    await page.getByRole("button", { name: /SYNTHETIC-EXTENSION/ }).click();
    await expect(
      reader.getByRole("heading", { name: "FUTURE TYPE", exact: true }).first()
    ).toBeVisible();
    await expect(
      panel.getByRole("heading", { name: "Additional fields", exact: true }).first()
    ).toBeVisible();
    for (const text of [
      "Future extension",
      "Nested extension",
      "Policy note",
      "first extension item",
      "last extension item",
      "false",
      "0 Hz",
      "Unavailable (null)",
      "None supplied (empty list)",
      "Not supplied",
      "<img src=x onerror=alert('reference-only')>",
      "javascript:alert('reference-only')",
    ]) {
      await expect(panel).toContainText(text);
    }
    await expect(panel.locator("img")).toHaveCount(0);
    await expect(panel.locator('a[href^="javascript:"]')).toHaveCount(0);
    const extension = JSON.parse(fixture.message_records[14].structured_payload_json!);
    await expect(panel).toContainText(extension.future_extension.long_token);
    await tabs.nth(0).focus();
    for (const [key, index] of [
      ["ArrowRight", 1],
      ["ArrowRight", 2],
      ["Home", 0],
    ] as const) {
      await page.keyboard.press(key);
      await expect(tabs.nth(index)).toBeFocused();
      await expect(tabs.nth(index)).toHaveAttribute("aria-selected", "true");
      await expect(panel).toHaveAttribute(
        "aria-labelledby",
        (await tabs.nth(index).getAttribute("id"))!
      );
    }
    for (const colorScheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.emulateMedia({ colorScheme });
      await panel.scrollIntoViewIfNeeded();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      );
      const accessibility = await new AxeBuilder({ page })
        .include(".message-reader")
        .withRules(["color-contrast", "aria-valid-attr-value", "aria-required-children"])
        .analyze();
      expect(accessibility.violations).toEqual([]);
      await stack.screenshot({ page, deliverable: true, name: `journey-mobile-${colorScheme}` });
    }

    const editor = page.getByRole("textbox", { name: "Acknowledgement text" });
    await editor.fill("Private structured reference draft. Do not transmit.");
    await tabs.nth(2).click();
    const history = (await panel.textContent())!;
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(page.getByText("Saved · Unsent", { exact: true })).toBeVisible();
    await expect(panel).toHaveText(history);
    const read = page.waitForResponse(
      (response) =>
        response.url().endsWith("/app.v1.SourceDataService/ReadSchedules") && response.ok()
    );
    await page.reload();
    expect(JSON.stringify(await (await read).json())).not.toContain(
      "Private structured reference draft"
    );
    await expect(editor).toHaveValue("Private structured reference draft. Do not transmit.");
    await expect(tabs.nth(0)).toHaveAttribute("aria-selected", "true");
    await tabs.nth(2).click();
    await expect(panel).toHaveText(history);
    await editor.fill("Edited private reference draft, still unsent.");
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(page.getByText("Saved · Unsent", { exact: true })).toBeVisible();
    await expect(panel).toHaveText(history);

    await page.getByRole("button", { name: /FICTIONAL-LEGACY/ }).click();
    await expect(
      panel.getByRole("heading", { name: "Legacy briefing", exact: true })
    ).toBeVisible();
    await expect(panel).toContainText("Lines 2");
    await expect(panel.getByRole("heading", { name: "Message metadata", exact: true })).toHaveCount(
      0
    );
    await tabs.nth(1).click();
    await expect(panel.locator(".raw-lines li")).toHaveCount(2);
    await expect(panel.locator(".raw-lines li").nth(1)).toContainText("Time / Location");
    await tabs.nth(2).click();
    await expect(panel.getByRole("listitem")).toHaveCount(1);
    await expect(panel).toContainText("Received");
    await expect(
      page.getByRole("link", { name: "Return to Calendar", exact: true })
    ).toHaveAttribute("href", returnTo);
    await page.getByRole("link", { name: "Return to Calendar", exact: true }).click();
    await expect(page).toHaveURL(`${stack.url}${returnTo}`);
    await stack.assertNoServerErrors();
  } finally {
    await stack.teardown();
  }
});
