# Browser journeys

This directory starts without a spec. Add a journey when a story has a real
user action to check. Ark runs every `*.spec.ts` here with the protected
pipeline's Playwright config, a private app process, and a fresh SQLite database.
The runner fails on unexpected browser console errors, uncaught exceptions, and
server errors even if the visible assertion passes.

A journey belongs to the app. Name the test for the user outcome, use real
navigation and controls, and check the result without reloading the page. Keep
fixtures under `ui/tests/journey/fixtures/` and commit them with the spec.

```ts
import { expect, test } from "@playwright/test";
import { withEphemeralStack } from "../../../ark/pipeline/journey-stack";

test("visitor completes the story outcome", async ({ page }) => {
  const stack = await withEphemeralStack({ fixture: "./fixtures/story.json" });
  try {
    await page.goto(stack.url);
    await page.getByRole("link", { name: "Feature" }).click();
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Saved")).toBeVisible();
    await stack.assertNoServerErrors();
  } finally {
    await stack.teardown();
  }
});
```

Use `ark run job journey` to run the app's journeys. The helper and browser
error guard are Ark-owned. The app owns its specs, fixtures, and any optional
libraries the feature uses; install those as direct dependencies with a lockfile
update before committing.

The lifecycle journey uses `fixtures/view-message-record-lifecycle.json` through
the real framework seeder and RPC service, not browser response stubs. Its four
explicitly fictional records cover supplied acknowledgement evidence, repeated
and tied milestones across a UTC day boundary, an undated custom milestone,
absent history, and legacy received-only history. These examples are not upstream
processing evidence. The journey also verifies tab keyboard/panel associations,
selection and reload defaults, private draft saves that leave history unchanged,
Calendar returns, and desktop/light plus narrow/dark screenshots.
