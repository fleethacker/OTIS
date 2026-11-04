// route-registry.test.ts — pins the path-collision error so a future
// regression in the discovery pipeline can't silently shadow a page
// again. The bug: App Shell's placeholder dashboard and a feature
// epic's real dashboard both registered path "/", and the registry
// silently picked one — leaving the other as dead code with no warning.

import { describe, expect, it } from "bun:test";
import { assertNoPathCollisions } from "./route-registry";

describe("assertNoPathCollisions", () => {
  it("passes when every concrete path is unique", () => {
    expect(() =>
      assertNoPathCollisions([
        { path: "/", key: "./pages/home.tsx" },
        { path: "/links", key: "./pages/links.tsx" },
        { path: "/links/:id", key: "./pages/link-detail.tsx" },
      ])
    ).not.toThrow();
  });

  it("throws when two pages claim the same path, naming both files", () => {
    expect(() =>
      assertNoPathCollisions([
        { path: "/", key: "./pages/dashboard.tsx" },
        { path: "/", key: "./pages/operations-dashboard.tsx" },
      ])
    ).toThrow(/dashboard\.tsx.*operations-dashboard\.tsx/);
  });

  it("allows multiple registrations of the catch-all '*' since _placeholder owns it", () => {
    expect(() =>
      assertNoPathCollisions([
        { path: "*", key: "./pages/_placeholder.tsx" },
        { path: "*", key: "./pages/_other.tsx" },
      ])
    ).not.toThrow();
  });
});
