// The journey runner binds this trusted fixture as @playwright/test while it
// executes app-owned specs. The CLI and base fixtures remain the shipped
// Playwright package in the read-only toolchain.
import { test as base } from "../../node_modules/@playwright/test/index.mjs";
export * from "../../node_modules/@playwright/test/index.mjs";

const maxFindings = 20;
const maxFindingLength = 1_000;

export const test = base.extend({
  _journeyFailureEvidence: [
    async ({}, use, testInfo) => {
      try {
        await use();
      } finally {
        const callbacks = testInfo[Symbol.for("ark.journey.failureEvidence")] || [];
        for (const finalize of callbacks) {
          try {
            await finalize();
          } catch (error) {
            // Diagnostic write failures must not hide the original test failure or
            // prevent cleanup of other stacks owned by this test.
            console.warn("Journey failure evidence could not be retained:", error);
          }
        }
        delete testInfo[Symbol.for("ark.journey.failureEvidence")];
      }
    },
    { auto: true },
  ],
  // Dependency order keeps evidence until browser validation has set test status.
  context: async ({ context, _journeyFailureEvidence }, use, testInfo) => {
    const findings = [];
    let total = 0;
    const record = (kind, detail, source = "", status = 0) => {
      total++;
      if (findings.length < maxFindings) {
        findings.push({
          kind,
          detail: `${kind}: ${String(detail).slice(0, maxFindingLength)}`,
          source,
          status,
          observedAt: Date.now(),
        });
      }
    };
    const onConsole = (message) => {
      if (message.type() !== "error") return;
      const location = message.location().url;
      let source = "";
      if (location) {
        try {
          source = new URL(location).pathname;
        } catch {
          source = location.split(/[?#]/, 1)[0];
        }
      }
      const status = /Failed to load resource:.*status of ([45]\d\d)\b/.exec(message.text());
      record(
        "console.error",
        source ? `${source}: ${message.text()}` : message.text(),
        source,
        status ? Number(status[1]) : 0
      );
    };
    const onWebError = (webError) => {
      const error = webError.error();
      record("uncaught browser exception", error.stack || error.message);
    };
    context.on("console", onConsole);
    context.on("weberror", onWebError);
    try {
      await use(context);
    } finally {
      context.off("console", onConsole);
      context.off("weberror", onWebError);
    }
    const remaining = [...findings];
    const missing = [];
    for (const annotation of testInfo.annotations) {
      if (annotation.type !== "ark-expected-browser-http-error") continue;
      let expected;
      try {
        expected = JSON.parse(annotation.description || "");
      } catch {
        throw new Error("Malformed expected browser HTTP error declaration");
      }
      if (
        typeof expected.path !== "string" ||
        !expected.path.startsWith("/") ||
        expected.path === "/" ||
        /[?#*]/.test(expected.path) ||
        expected.path.length > 200 ||
        typeof expected.status !== "number" ||
        !Number.isInteger(expected.status) ||
        expected.status < 400 ||
        expected.status > 599 ||
        typeof expected.reason !== "string" ||
        expected.reason.trim().length < 10 ||
        expected.reason.length > 200 ||
        !Number.isInteger(expected.registeredAt)
      ) {
        throw new Error("Invalid expected browser HTTP error declaration");
      }
      const matches = remaining.filter(
        (finding) =>
          finding.kind === "console.error" &&
          finding.source === expected.path &&
          finding.status === expected.status &&
          finding.observedAt >= expected.registeredAt
      );
      if (matches.length === 0) missing.push(`${expected.path} returned ${expected.status}`);
      else {
        for (const match of matches) remaining.splice(remaining.indexOf(match), 1);
      }
    }
    if (remaining.length > 0 || missing.length > 0 || total > findings.length) {
      const details = [];
      if (remaining.length > 0) {
        details.push(
          `${remaining.length} unexpected browser error(s):\n${remaining.map((finding) => finding.detail).join("\n")}`
        );
      }
      if (missing.length > 0)
        details.push(`Expected HTTP errors not observed: ${missing.join(", ")}`);
      if (total > findings.length)
        details.push(`[${total - findings.length} further errors omitted]`);
      throw new Error(`Journey browser validation failed:\n${details.join("\n")}`);
    }
  },
});
