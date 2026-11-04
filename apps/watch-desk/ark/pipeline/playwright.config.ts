import { defineConfig } from "@playwright/test";

/**
 * Playwright config for **journey tests** — per-story specs that run
 * against a per-test ephemeral stack (built `bun run build:ui`
 * artifacts + `go build` binary on a fresh SQLite seeded from the
 * story's fixture).
 * Distinct from the workspace's regular Playwright config (smoke tests
 * against the shared dev server) so the two suites don't fight over
 * port assignments, fixture state, or test isolation.
 *
 * Each spec uses `withEphemeralStack({ fixture })` from `./journey-stack`
 * to provision its own backend; no shared `webServer` here. Tests that
 * forget to use the helper just won't have anything to talk to — that's
 * the right error mode (loud, fast).
 */
export default defineConfig({
  testDir: `${process.cwd()}/ui/tests/journey`,
  // The protected config is read-only in the toolchain. Write reporter output
  // into the disposable workspace validation tree so it can be collected.
  outputDir: `${process.cwd()}/test-results`,
  reporter: [
    ["line"],
    ["json", { outputFile: `${process.cwd()}/test-results/journey-report.json` }],
  ],
  testMatch: /\.spec\.ts$/,
  fullyParallel: true,
  forbidOnly: true,
  retries: process.env.CI === "true" ? 1 : 0,
  // Retries preserve diagnostics; recovered failures still block qualification.
  failOnFlakyTests: true,
  // Per-story stacks bind to OS-assigned ports, so workers don't fight.
  // 4 is a reasonable upper bound on M-series; tune via env if a test
  // suite gets large.
  workers: process.env.CI === "true" ? 2 : 4,
  timeout: 60_000,
  expect: {
    // Mutation-roundtrip assertions assert UI updates within ~500ms;
    // give Playwright's expect.toHaveText / toBeVisible a slightly
    // larger ceiling so a slow CI runner doesn't false-fail. Stories
    // that need a tighter bound override per-assertion.
    timeout: 5_000,
  },
  use: {
    actionTimeout: 5_000,
    navigationTimeout: 10_000,
    // Force the dark color scheme. Headless Chromium reports
    // prefers-color-scheme: light by default (it never inherits the host
    // OS setting), and the generated app picks its daisyUI theme straight
    // off that media query in main.tsx — so without this every journey
    // deliverable screenshot renders the light variant regardless of the
    // developer's dark-mode system. Dark is the app's primary identity
    // and matches the wizard preview iframe, so pin it here.
    colorScheme: "dark",
    // Trace + screenshot on failure for post-mortem in CI; the journey
    // deliverable screenshot stack.screenshot({ deliverable: true })
    // emits is separate — it lands locally in tests/journey/.artifacts/
    // and uploads to the orphan ark/state branch via
    // `ark upload-artifact` (ADR-0009).
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "journey",
      use: {
        // Headless. The journey deliverable screenshot is the visible
        // artifact; running headed would be a debugging convenience
        // only. Override locally with `bun run test:journey -- --headed`.
        headless: true,
      },
    },
  ],
});
