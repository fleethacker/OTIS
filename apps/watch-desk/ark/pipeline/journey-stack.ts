// Ark-owned journey fixtures and screenshot helpers. Builds are prepared once by ark run.
import { promises as fs } from "node:fs";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { startJourneyApp, type JourneyAppEvidence } from "./journey-process";
import { stat } from "node:fs/promises";

import * as path from "node:path";

import { type Page, type TestInfo } from "@playwright/test";

const contextFile = process.env.ARK_JOURNEY_CONTEXT;
if (!contextFile) throw Error("Run journey specs through ark run job journey");
const context: { root: string; binary: string; dataRoot: string; uploadArtifacts?: boolean } =
  JSON.parse(readFileSync(contextFile, "utf8"));
const workspaceRoot = context.root;
const goBinaryPath = context.binary;

export interface WithEphemeralStackOptions {
  fixture: string;

  storyId?: string;

  /** App role to exercise. Omit to use the app's default mock identity. */
  role?: string;
}

export interface EphemeralStack {
  url: string;

  screenshot: (opts: ScreenshotOptions) => Promise<void>;

  assertNoServerErrors: (opts?: { allow?: Array<string | RegExp> }) => Promise<void>;

  expectBrowserHTTPError: (expected: {
    path: string;
    status: number;
    reason: string;
  }) => Promise<void>;

  teardown: () => Promise<void>;
}

export interface ScreenshotOptions {
  page: Page;

  deliverable?: boolean;

  name?: string;

  path?: string;
}

// The trusted automatic fixture runs these callbacks after browser validation and
// after the test's finally block, when Playwright has recorded its real status.
const failureEvidenceKey = Symbol.for("ark.journey.failureEvidence");
type JourneyEvidenceTestInfo = TestInfo & {
  [failureEvidenceKey]?: Array<() => Promise<void>>;
};

export async function withEphemeralStack(opts: WithEphemeralStackOptions): Promise<EphemeralStack> {
  const resolvedFixture = await resolveFixturePath(opts.fixture);
  let testInfo: JourneyEvidenceTestInfo | undefined;
  try {
    const { test } = await import("@playwright/test");
    testInfo = test.info();
  } catch {
    // Standalone helper consumers have no Playwright test output directory.
  }
  let evidence: JourneyAppEvidence | undefined;
  let closeApp: (() => Promise<void>) | undefined;
  if (testInfo) {
    const info = testInfo;
    const callbacks = (info[failureEvidenceKey] ??= []);
    const stackIndex = callbacks.length + 1;
    callbacks.push(async () => {
      await closeApp?.();
      const captured = evidence;
      evidence = undefined;
      if (
        !captured ||
        (info.status !== "failed" && info.status !== "timedOut" && info.status !== "interrupted")
      )
        return;
      const output = info.outputPath(`journey-stack-${stackIndex}`);
      await fs.mkdir(output, { recursive: true, mode: 0o700 });
      const artifacts = [
        { name: "server.log", body: captured.logs.join(""), contentType: "text/plain" },
        {
          name: captured.seedTruncated ? "seed-prefix.txt" : "seed.json",
          body: captured.seed,
          contentType: captured.seedTruncated ? "text/plain" : "application/json",
        },
        {
          name: "execution.json",
          body: JSON.stringify(
            {
              version: 1,
              status: info.status,
              expectedStatus: info.expectedStatus,
              retry: info.retry,
              workerIndex: info.workerIndex,
              parallelIndex: info.parallelIndex,
              seedTruncated: captured.seedTruncated,
            },
            null,
            2
          ),
          contentType: "application/json",
        },
      ];
      for (const artifact of artifacts) {
        const artifactPath = path.join(output, artifact.name);
        await fs.writeFile(artifactPath, artifact.body, { mode: 0o600 });
        await info.attach(`journey-stack-${stackIndex}/${artifact.name}`, {
          path: artifactPath,
          contentType: artifact.contentType,
        });
      }
    });
  }
  const app = await startJourneyApp(
    workspaceRoot,
    goBinaryPath,
    resolvedFixture,
    context.dataRoot,
    opts.role,
    testInfo
      ? (captured) => {
          evidence = captured;
        }
      : undefined
  );
  closeApp = app.close;
  const serverLog = app.logs;
  const captureID = crypto.randomUUID();

  return {
    url: app.url,
    screenshot: async (s: ScreenshotOptions) => {
      let outPath = s.path;
      let isPrimary = false;
      let storyIdForUpload: string | undefined;
      let uploadBaseName: string | undefined;
      if (s.deliverable === true) {
        if (opts.storyId === undefined) {
          throw new Error(
            "stack.screenshot({ deliverable: true }) requires storyId in withEphemeralStack(...)"
          );
        }
        const baseName = s.name?.trim() || "journey";
        if (!/^[a-z0-9_-]+$/i.test(baseName)) {
          throw new Error(
            `screenshot({ name }) must match /^[a-z0-9_-]+$/i, got ${JSON.stringify(baseName)}`
          );
        }
        isPrimary = baseName === "journey";
        storyIdForUpload = opts.storyId;
        uploadBaseName = `${baseName}.png`;
        outPath = path.join(
          process.cwd(),
          "tests",
          "journey",
          ".artifacts",
          captureID,
          `${baseName}.png`
        );
      }
      if (outPath === undefined) {
        throw new Error("screenshot() requires either { deliverable: true } or { path }");
      }
      await fs.mkdir(path.dirname(outPath), { recursive: true });
      await s.page.screenshot({ path: outPath, fullPage: false });
      if (
        s.deliverable === true &&
        storyIdForUpload !== undefined &&
        uploadBaseName !== undefined &&
        context.uploadArtifacts !== false
      ) {
        const proc = spawnSync(
          process.env.ARK_BIN?.trim() || "ark",
          [
            "upload-artifact",
            "--story",
            storyIdForUpload,
            "--file",
            outPath,
            "--name",
            uploadBaseName,
          ],
          { stdio: ["ignore", "pipe", "pipe"] }
        );
        if (proc.status !== 0) {
          const stderr = proc.stderr?.toString() ?? "";
          const stdout = proc.stdout?.toString() ?? "";
          console.warn(
            `journey-stack: ark upload-artifact failed (exit ${proc.status ?? "?"}); the screenshot is at ${outPath} but did not land on ark/state. ${stderr || stdout}`
          );

          return;
        }
        if (isPrimary) {
          const latestPath = path.join(workspaceRoot, ".ark", "screenshots", "latest.png");
          await fs.mkdir(path.dirname(latestPath), { recursive: true });
          await fs.copyFile(outPath, latestPath);
        }
      }
    },
    assertNoServerErrors: async (opts?: { allow?: Array<string | RegExp> }) => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      const allow = opts?.allow ?? [];
      const isAllowed = (line: string): boolean =>
        allow.some((a) => (typeof a === "string" ? line.includes(a) : a.test(line)));
      const offenders = serverLog
        .join("")
        .split("\n")
        .filter((line) => {
          if (isAllowed(line)) return false;
          return (
            /\blevel=ERROR\b/.test(line) ||
            // slog.Default uses the standard Go log prefix unless replaced.
            /^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)? ERROR(?:\+\d+)?(?:\s|$)/.test(line) ||
            /\bpanic:/.test(line) ||
            / - 5\d\d /.test(line)
          );
        });
      if (offenders.length > 0) {
        throw new Error(
          `journey-stack: backend logged ${offenders.length} server error(s) during the journey. ` +
            `The UI may render fine against seed data while the server is failing — exactly the ` +
            `false-green this guard catches. Fix the backend; or if a line is a handled error this ` +
            `story exercises on purpose, whitelist it: assertNoServerErrors({ allow: [/substring or regex/] }).\n\n` +
            offenders.slice(0, 20).join("\n")
        );
      }
    },
    expectBrowserHTTPError: async ({ path: requestPath, status, reason }) => {
      if (
        !requestPath.startsWith("/") ||
        requestPath === "/" ||
        /[?#*]/.test(requestPath) ||
        requestPath.length > 200 ||
        !Number.isInteger(status) ||
        status < 400 ||
        status > 599 ||
        reason.trim().length < 10 ||
        reason.length > 200
      ) {
        throw new Error("Expected browser HTTP errors need an exact path, status, and reason");
      }
      const { test } = await import("@playwright/test");
      test.info().annotations.push({
        type: "ark-expected-browser-http-error",
        description: JSON.stringify({
          path: requestPath,
          status,
          reason,
          registeredAt: Date.now(),
        }),
      });
    },
    teardown: app.close,
  };
}

async function resolveFixturePath(fixture: string): Promise<string> {
  let absolute: string;
  if (path.isAbsolute(fixture)) {
    absolute = fixture;
  } else if (fixture.startsWith("./fixtures/") || fixture.startsWith("fixtures/")) {
    absolute = path.join(workspaceRoot, "ui", "tests", "journey", fixture.replace(/^\.\//, ""));
  } else {
    absolute = path.resolve(fixture);
  }
  await stat(absolute);

  return absolute;
}
