// Initialize the route registry FIRST. `_placeholder` and `route-registry` form
// a cycle (the page reads `navRoutes`; the registry imports the page for its
// `route` meta). In the real app the registry evaluates first so the cycle
// resolves cleanly; a test that imports the page as its entry would instead hit
// the registry reading the page's still-uninitialized `route` (ESM TDZ). This
// side-effect import forces the registry to finish before the page's bindings
// are touched below.
import "../route-registry";
import { describe, it, expect } from "bun:test";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "../test-utils/render";
import { routes } from "../route-registry";
import Placeholder, { BuildingCard, NotFoundCard } from "./_placeholder";

// The catch-all must NOT show "Building your application" for a wrong/dead link
// in a built app — that masked routing bugs as "still building". These lock in
// the two distinct states.
//
// The cards are asserted DIRECTLY rather than reached through `Placeholder`,
// because which branch `Placeholder` takes depends on the ambient `navRoutes`,
// and that changes as the app gets built. This file used to assert the building
// card via `Placeholder` with a comment reading "in the bare template navRoutes
// is empty" — which made it a test that passes only before App Shell runs.
// App Shell's job is to create the first page with a `route` export, so the
// first App Shell commit flipped `navRoutes` non-empty, `Placeholder` correctly
// rendered the 404 instead, and `test-ui` went red on the pipeline. The story
// hadn't done anything wrong; the template shipped a test that could not
// survive its own scaffolding.
describe("_placeholder catch-all", () => {
  function previewCaptureReady(root: HTMLElement): boolean {
    return (
      root.children.length > 0 && !root.querySelector('[data-ark-preview-placeholder="building"]')
    );
  }

  it("does not consider an unmounted or building application ready for preview capture", () => {
    const host = document.createElement("div");
    host.innerHTML = '<div id="root"></div>';
    expect(previewCaptureReady(host.querySelector<HTMLElement>("#root")!)).toBeFalse();

    host.innerHTML =
      '<div id="root"><main><div data-ark-preview-placeholder="building"></div></main></div>';
    expect(previewCaptureReady(host.querySelector<HTMLElement>("#root")!)).toBeFalse();

    host.innerHTML = '<div id="root"><main>Ready application</main></div>';
    expect(previewCaptureReady(host.querySelector<HTMLElement>("#root")!)).toBeTrue();
  });

  it("BuildingCard shows the early-scaffold copy", () => {
    renderWithProviders(<BuildingCard />);
    expect(screen.getByText("Building your application")).toBeTruthy();
    expect(document.querySelector('[data-ark-preview-placeholder="building"]')).toBeTruthy();
  });

  it("NotFoundCard renders a real 404 for a dead link — not the building card", () => {
    renderWithProviders(<NotFoundCard pathname="/areas/4" />);
    expect(screen.getByText("Page not found")).toBeTruthy();
    expect(screen.getByText("/areas/4")).toBeTruthy();
    expect(screen.queryByText("Building your application")).toBeNull();
  });

  // The branch itself, asserted against whichever state this workspace is in.
  // Both arms encode a real invariant, so this holds in the bare template AND
  // in a built app instead of only the former.
  it("routes an unmatched path by whether any real page has landed", () => {
    renderWithProviders(<Placeholder />, { route: "/definitely-not-a-route" });

    if (!routes.some((r) => r.path !== "*")) {
      // Nothing built yet — every path is legitimately "still building".
      expect(screen.getByText("Building your application")).toBeTruthy();
    } else {
      // Pages exist, so a dead link is a dead link. Showing "building" here is
      // the bug this file was written to prevent.
      expect(screen.queryByText("Building your application")).toBeNull();
      expect(screen.getByText("Page not found")).toBeTruthy();
    }
  });
});
