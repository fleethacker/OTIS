import { test, expect } from "bun:test";
import { fireEvent } from "@testing-library/react";
import { useLocation } from "react-router-dom";
import { renderWithProviders } from "../test-utils/render";
import { NavigationMenu } from "./navigation-menu";
function CurrentRoute() {
  return <p>Route: {useLocation().pathname}</p>;
}

test("burger follows briefing, workspace and OTIS links and closes after selection", () => {
  const view = renderWithProviders(
    <>
      <NavigationMenu />
      <CurrentRoute />
    </>,
    { route: "/calendar" }
  );
  const trigger = view.getByRole("button", { name: "Navigation menu" });
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  expect(view.queryByRole("navigation")).toBeNull();
  fireEvent.click(trigger);
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
  expect(view.getByRole("dialog", { name: "Navigation menu" })).toBeTruthy();
  expect(view.getByRole("link", { name: "Shift briefing" })).toBe(document.activeElement);
  fireEvent.click(view.getByRole("link", { name: "Shift briefing" }));
  expect(view.getByText("Route: /shift")).toBeTruthy();
  expect(view.queryByRole("dialog")).toBeNull();
  fireEvent.click(trigger);
  fireEvent.click(view.getByRole("link", { name: "Message Search" }));
  expect(view.getByText("Route: /messages")).toBeTruthy();
  expect(view.queryByRole("dialog")).toBeNull();
  fireEvent.click(trigger);
  fireEvent.click(view.getByRole("link", { name: "Calendar" }));
  expect(view.getByText("Route: /calendar")).toBeTruthy();
  expect(view.queryByRole("dialog")).toBeNull();
  fireEvent.click(trigger);
  fireEvent.click(view.getByRole("link", { name: "About OTIS" }));
  expect(view.getByText("Route: /about")).toBeTruthy();
  expect(view.queryByRole("dialog")).toBeNull();
});
test("reusable popover dismisses on Escape, outside click and focus departure", () => {
  const view = renderWithProviders(
    <>
      <NavigationMenu />
      <button>Outside</button>
    </>
  );
  const trigger = view.getByRole("button", { name: "Navigation menu" });
  fireEvent.click(trigger);
  fireEvent.keyDown(view.getByRole("link", { name: "Calendar" }), { key: "Escape" });
  expect(view.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(trigger);
  fireEvent.click(trigger);
  fireEvent.pointerDown(view.getByRole("button", { name: "Outside" }));
  expect(view.queryByRole("dialog")).toBeNull();
  fireEvent.click(trigger);
  fireEvent.blur(view.getByRole("link", { name: "Calendar" }), {
    relatedTarget: view.getByRole("button", { name: "Outside" }),
  });
  expect(view.queryByRole("dialog")).toBeNull();
});
test("menu links still navigate when the click does not focus them (Safari/macOS)", () => {
  const view = renderWithProviders(
    <>
      <NavigationMenu />
      <CurrentRoute />
    </>,
    { route: "/calendar" }
  );
  for (const [name, path] of [["Message Search", "/messages"], ["About OTIS", "/about"]]) {
    fireEvent.click(view.getByRole("button", { name: "Navigation menu" }));
    const link = view.getByRole("link", { name });
    // Mousedown on a non-focusable link: focus leaves to nothing before click fires.
    fireEvent.blur(view.getByRole("link", { name: "Calendar" }), { relatedTarget: null });
    expect(view.getByRole("dialog", { name: "Navigation menu" })).toBeTruthy();
    fireEvent.click(link);
    expect(view.getByText(`Route: ${path}`)).toBeTruthy();
    expect(view.queryByRole("dialog")).toBeNull();
  }
});
