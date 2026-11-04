// Bun test preload — wires happy-dom + jest-dom + the console.error spy
// that fails tests on React mount crashes. Loaded via bunfig.toml's
// [test] preload entry, so it runs once per test process before any
// test file executes.

import { GlobalRegistrator } from "@happy-dom/global-registrator";

// Register a happy-dom window globally so React + @testing-library/react
// can mount components. Has to happen before any DOM-touching import.
// Relative application assets need an HTTP base. Happy DOM 20 emits an
// immediate error when it resolves them against about:blank.
GlobalRegistrator.register({ url: "http://localhost/" });

// Now that document/window exist, install jest-dom's matchers + bun:test's
// lifecycle hooks. Imports stay below the GlobalRegistrator call —
// importing jest-dom matchers before the DOM exists is a foot-gun.
const { expect, afterEach, beforeEach, spyOn } = await import("bun:test");
const matchers = await import("@testing-library/jest-dom/matchers");
const { cleanup } = await import("@testing-library/react");

// jest-dom ships matchers under default export AND named — try default first.
const matcherSet =
  (matchers as { default?: Record<string, unknown> }).default ??
  (matchers as Record<string, unknown>);
expect.extend(matcherSet as Parameters<typeof expect.extend>[0]);

// Fail the test if console.error fires during render. This is how we
// catch the class of mount crashes that lint + typecheck can't see —
// missing providers, mismatched React Query instances, component throws
// caught by React's error boundary. The captured messages appear in the
// failure output so the agent knows where to look.
let capturedErrors: string[] = [];

beforeEach(() => {
  capturedErrors = [];
  spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    capturedErrors.push(args.map((a) => (typeof a === "string" ? a : String(a))).join(" "));
  });
});

afterEach(() => {
  cleanup();
  const errors = [...capturedErrors];
  capturedErrors = [];
  // bun:test auto-restores spyOn'd functions between tests via the
  // [test] autoRestore setting; nothing to do explicitly.
  if (errors.length > 0) {
    throw new Error(`console.error fired during test:\n${errors.join("\n")}`);
  }
});
