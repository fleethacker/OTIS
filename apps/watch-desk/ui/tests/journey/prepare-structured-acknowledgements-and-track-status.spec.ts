import { test, expect } from "@playwright/test";
import { withEphemeralStack } from "../../../ark/pipeline/journey-stack";

test("prepare private acknowledgements, copy manually and retain external tracking history", async ({ page }) => {
  test.setTimeout(180_000);
  const stack = await withEphemeralStack({
    fixture: "fixtures/prepare-structured-acknowledgements-and-track-status.json",
    storyId: "prepare-structured-acknowledgements-and-track-status",
  });
  try {
    // Only the browser clipboard boundary is replaced; persistence uses the real stack.
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
        writeText: async (text: string) => {
          if (sessionStorage.getItem("clipboard-failure")) throw new Error("Clipboard denied");
          sessionStorage.setItem("copied-message", text);
        },
      } });
    });
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto(stack.url);
    await page.getByRole("link", { name: "Message records", exact: true }).click();
    const first = page.getByRole("button", { name: /FICTIONAL-PREPARE-001/ });
    const second = page.getByRole("button", { name: /FICTIONAL-PREPARE-002/ });
    await first.click();
    const legacy = page.getByRole("textbox", { name: "Acknowledgement text", exact: true });
    const legacyText = "Private legacy text\n  Preserve whitespace and unsent meaning.  ";
    await legacy.fill(legacyText);
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(page.getByText("Saved · Unsent", { exact: true })).toBeVisible();
    const form = page.getByRole("region", { name: "Prepare acknowledgement", exact: true });
    const generate = form.getByRole("button", { name: "Generate message" });
    const preview = form.getByRole("textbox", { name: "Reviewable message (plain text)" });
    const copy = form.getByRole("button", { name: "Copy message" });
    await expect(form).toContainText("FICTIONAL-PREPARE-001");
    for (const name of ["Outgoing originator", "Original reference originator", "Reference message type", "Reference issue DTG (DDHHMMZMONYYYY)"]) {
      await expect(form.getByRole("textbox", { name, exact: true })).toHaveValue("");
    }
    await generate.click();
    await expect(form.getByRole("alert")).toContainText("Required for generation");
    await expect(copy).toBeDisabled();
    await form.getByRole("textbox", { name: "Outgoing originator", exact: true }).fill("USS EXAMPLE");
    await form.getByRole("button", { name: "Save preparation", exact: true }).click();
    await expect(form.getByRole("status")).toHaveText("Preparation saved · Unsent");
    await page.reload();
    await expect(legacy).toHaveValue(legacyText);
    await expect(form.getByRole("textbox", { name: "Outgoing originator", exact: true })).toHaveValue("USS EXAMPLE");
    for (const [name, value] of [
      ["Reference letter (A-Z)", "A"], ["Reference message type", "OPTASK LINK"],
      ["Original reference originator", "CTF DEMO"], ["Reference issue DTG (DDHHMMZMONYYYY)", "291200ZFEB2023"],
      ["Responding authority", "FICTIONAL AUTHORITY"], ["Reviewer notes (private metadata, not message body)", "Private reviewer note"],
    ]) await form.getByRole("textbox", { name, exact: true }).fill(value);
    await form.getByLabel("Response family", { exact: true }).selectOption("ACTAGCY");
    const response = form.getByLabel("How can your command respond?", { exact: true });
    await expect(response).toHaveValue("");
    await expect(response.locator("option")).toHaveText([
      "Choose a response", "ACK — Acknowledge: understanding, not compliance",
      "WILCO — Will comply: intent to comply", "HAVCO — Have complied: compliance completed", "CANTCO — Cannot comply",
    ]);
    await response.selectOption("ACK");
    await generate.click();
    await expect(form.getByRole("alert")).toContainText("real Zulu date");
    await expect(form.getByRole("alert")).toContainText("Confirm understanding");
    await form.getByLabel(/I confirm understanding/).check();
    await form.getByLabel("Reference issue DTG (DDHHMMZMONYYYY)", { exact: true }).fill("291200ZFEB2024");
    await form.getByLabel("Outgoing originator", { exact: true }).fill("BAD/INJECTION");
    await generate.click();
    await expect(form.getByRole("alert")).toContainText("Remove delimiters");
    await expect(form.getByLabel("Outgoing originator", { exact: true })).toHaveValue("BAD/INJECTION");
    await form.getByLabel("Outgoing originator", { exact: true }).fill("USS EXAMPLE");
    await form.getByLabel("Optional context (mutually exclusive)", { exact: true }).selectOption("EXER");
    await form.getByLabel("Exercise identity or operation codeword", { exact: true }).fill("FICTIONAL DEMO");
    let expected = "";
    for (const [family, codes] of [["ACTAGCY", ["ACK", "WILCO", "HAVCO", "CANTCO"]], ["ICVALID", ["NONVAL", "VALID", "VALCHG"]]] as const) {
      await form.getByLabel("Response family", { exact: true }).selectOption(family);
      if (family === "ICVALID") {
        await expect(response).toHaveValue("");
        await expect(response.locator("option")).toHaveText(["Choose a response", "NONVAL — Nonvalidated", "VALID — Validated", "VALCHG — Validated with change"]);
        await form.getByLabel("Optional context (mutually exclusive)", { exact: true }).selectOption("OPER");
      }
      for (const code of codes) {
        await response.selectOption(code);
        await generate.click();
        await expect(form.getByRole("status")).toHaveText("Generated and saved · Unsent");
        expected = `${family === "ACTAGCY" ? "EXER" : "OPER"}/FICTIONAL DEMO//\nMSGID/AKNLDG/USS EXAMPLE//\nREF/A/OPTASK LINK/CTF DEMO/291200ZFEB2024//\n${family}/FICTIONAL AUTHORITY/${code}/A//`;
        await expect(preview).toHaveValue(expected);
      }
    }
    await copy.focus();
    await page.keyboard.press("Enter");
    await expect(form.getByRole("status")).toHaveText("Message copied. Paste manually into email; nothing sent.");
    expect(await page.evaluate(() => sessionStorage.getItem("copied-message"))).toBe(expected);
    await page.evaluate(() => sessionStorage.setItem("clipboard-failure", "1"));
    await copy.click();
    await expect(form.getByRole("alert")).toHaveText("Copy failed. Select the preview text and copy manually.");
    await expect(preview).toHaveValue(expected);
    await expect(form.getByRole("status")).toHaveCount(0);
    await page.reload();
    await expect(preview).toHaveValue(expected);
    await expect(legacy).toHaveValue(legacyText);
    await preview.scrollIntoViewIfNeeded();
    await stack.screenshot({ page, deliverable: true });
    await form.getByLabel("Responding authority", { exact: true }).fill("CORRECTED AUTHORITY");
    await expect(preview).toHaveValue("");
    await expect(copy).toBeDisabled();
    await expect(form.getByRole("status")).toContainText("Output invalidated");
    await stack.expectBrowserHTTPError({ path: "/app.v1.DraftService/SavePreparation", status: 503, reason: "Controlled preparation save outage" });
    await page.route("**/app.v1.DraftService/SavePreparation", route => route.fulfill({ status: 503, contentType: "application/json", body: '{"code":"unavailable","message":"controlled outage"}' }));
    await generate.click();
    await expect(form.getByRole("alert")).toContainText("Preparation save failed");
    await expect(form.getByLabel("Responding authority", { exact: true })).toHaveValue("CORRECTED AUTHORITY");
    await page.unroute("**/app.v1.DraftService/SavePreparation");
    await generate.click();
    await expect(form.getByRole("status")).toHaveText("Generated and saved · Unsent");
    await page.getByRole("tab", { name: "Lifecycle", exact: true }).click();
    const tracking = page.getByRole("region", { name: "Private acknowledgement tracking", exact: true });
    const upstream = page.locator(".message-lifecycle");
    await expect(tracking).toContainText("Not recorded as acknowledged in personal tracking");
    await expect(tracking.getByRole("listitem").filter({ hasText: "Acknowledged · User-reported" })).toHaveCount(0);
    const upstreamText = (await upstream.textContent())!;
    await tracking.getByRole("button", { name: "Record external acknowledgement", exact: true }).click();
    await expect(tracking.getByRole("alert")).toContainText("Confirm that acknowledgement occurred outside");
    await tracking.getByLabel("I confirm acknowledgement occurred outside Watch Desk.", { exact: true }).check();
    await tracking.getByLabel("Optional tracking note", { exact: true }).fill("Private manual email report");
    await tracking.getByRole("button", { name: "Record external acknowledgement", exact: true }).click();
    await expect(tracking.getByRole("status")).toHaveText("External acknowledgement recorded.");
    await expect(tracking).toContainText("Acknowledged · User-reported outside Watch Desk");
    const recorded = tracking.getByRole("listitem").filter({ hasText: "Private manual email report" });
    await expect(recorded).toContainText("Occurred: Unavailable");
    await expect(recorded).toContainText(/Recorder: .+ · Recorded: \d{4}-/);
    await page.reload();
    await page.getByRole("tab", { name: "Lifecycle", exact: true }).click();
    await expect(recorded).toBeVisible();
    await tracking.getByLabel("Optional tracking note", { exact: true }).fill("Correction: personal report withdrawn");
    await tracking.getByRole("button", { name: "Reset personal tracking", exact: true }).click();
    await expect(tracking.getByRole("status")).toHaveText("Personal tracking reset; history retained.");
    await expect(tracking).toContainText("Not recorded as acknowledged in personal tracking");
    await expect(recorded).toBeVisible();
    await expect(tracking).toContainText("Correction: personal report withdrawn");
    await expect(upstream).toHaveText(upstreamText);
    await second.click();
    await expect(legacy).toHaveValue("");
    await expect(preview).toHaveValue("");
    await expect(form.getByLabel("Outgoing originator", { exact: true })).toHaveValue("");
    await page.getByRole("tab", { name: "Lifecycle", exact: true }).click();
    await expect(tracking).toContainText("No private activity recorded.");
    await tracking.getByLabel("I confirm acknowledgement occurred outside Watch Desk.", { exact: true }).check();
    await tracking.getByLabel("Occurrence time (RFC3339 with timezone; blank if unknown)", { exact: true }).fill("2026-11-05T00:02:00Z");
    await tracking.getByRole("button", { name: "Record external acknowledgement", exact: true }).click();
    await expect(tracking.getByRole("status")).toHaveText("External acknowledgement recorded.");
    await expect(tracking.getByRole("listitem")).toContainText("Occurred: 2026-11-05T00:02:00Z");
    await tracking.getByRole("button", { name: "Reset personal tracking", exact: true }).click();
    await expect(tracking.getByRole("status")).toHaveText("Personal tracking reset; history retained.");
    await page.reload();
    await page.getByRole("tab", { name: "Lifecycle", exact: true }).click();
    await expect(tracking).toContainText("Not recorded as acknowledged in personal tracking");
    await expect(tracking.getByRole("listitem")).toHaveCount(2);
    await expect(upstream).toContainText("Acknowledged");
    await expect(upstream).toContainText("Fictional upstream acknowledgement evidence");
    await expect(upstream).toContainText("Source: fictional");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: "dark" });
    await tracking.scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await stack.screenshot({ page, deliverable: true, name: "journey-lifecycle-mobile-dark" });
    await first.click();
    await expect(legacy).toHaveValue(legacyText);
    await expect(preview).toHaveValue(/ICVALID\/CORRECTED AUTHORITY\/VALCHG\/A\/\//);
    await preview.scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await stack.screenshot({ page, deliverable: true, name: "journey-preview-mobile-dark" });
    await form.getByLabel("Outgoing originator", { exact: true }).scrollIntoViewIfNeeded();
    await stack.screenshot({ page, deliverable: true, name: "journey-form-mobile-dark" });
    await form.getByLabel("Outgoing originator", { exact: true }).fill("UNSAVED PRIVATE IDENTITY");
    let releaseIdentity!: () => void;
    const heldIdentity = new Promise<void>(resolve => { releaseIdentity = resolve; });
    await page.route("**/app.v1.AppService/GetIdentity", async route => {
      await heldIdentity;
      await route.continue();
    });
    await page.evaluate(() => window.dispatchEvent(new MessageEvent("message", { data: { type: "ark-auth-changed" } })));
    await expect(page.getByText("Private preparation hidden while account verification is unavailable.")).toBeVisible();
    await expect(form).toHaveCount(0);
    await expect(legacy).toHaveCount(0);
    releaseIdentity();
    await expect(form.getByLabel("Outgoing originator", { exact: true })).toHaveValue("USS EXAMPLE");
    await expect(legacy).toHaveValue(legacyText);
    await page.unroute("**/app.v1.AppService/GetIdentity");
    await page.getByRole("tab", { name: "Raw message", exact: true }).click();
    await expect(page.getByRole("region", { name: "Raw message", exact: true })).toContainText("Receipt time is not issue time.");
    const sourceRead = page.waitForResponse(response => response.url().endsWith("/app.v1.SourceDataService/ReadSchedules") && response.ok());
    await page.reload();
    const sharedSource = JSON.stringify(await (await sourceRead).json());
    for (const privateText of [legacyText, "Private reviewer note", "Private manual email report", "CORRECTED AUTHORITY", "personal report withdrawn"]) {
      expect(sharedSource).not.toContain(privateText);
    }
    await page.getByRole("tab", { name: "Lifecycle", exact: true }).click();
    await expect(tracking).toContainText("Not recorded as acknowledged in personal tracking");
    await expect(recorded).toBeVisible();
    await expect(tracking).toContainText("Correction: personal report withdrawn");
    await expect(page.getByRole("button", { name: "Summarize", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Send", exact: true })).toHaveCount(0);
    await stack.assertNoServerErrors();
  } finally {
    await stack.teardown();
  }
});
