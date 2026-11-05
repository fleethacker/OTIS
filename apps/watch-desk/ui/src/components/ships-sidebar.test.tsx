import "../route-registry";
import { expect, spyOn, test } from "bun:test";
import { act, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "../test-utils/render";
import { ShipsSidebar } from "./ships-sidebar";

test("Ships defaults open when a nonzero narrow viewport is not established", () => {
  const media = spyOn(window, "matchMedia").mockImplementation((query) => ({ matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true }));
  const view = renderWithProviders(<ShipsSidebar pending={false} retry={() => {}} onChange={() => {}} />);
  try { expect(view.container.querySelector("details")!.open).toBe(true); }
  finally { view.unmount(); media.mockRestore(); }
});

test("a media match alone cannot collapse a zero-width or desktop layout", () => {
  const width = Object.getOwnPropertyDescriptor(window, "innerWidth");
  const media = spyOn(window, "matchMedia").mockImplementation((query) => ({ matches: true, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true }));
  try {
    for (const value of [0, 1024]) {
      Object.defineProperty(window, "innerWidth", { value, configurable: true });
      const view = renderWithProviders(<ShipsSidebar pending={false} retry={() => {}} onChange={() => {}} />);
      expect(view.container.querySelector("details")!.open).toBe(true);
      view.unmount();
    }
  } finally {
    media.mockRestore();
    if (width) Object.defineProperty(window, "innerWidth", width);
    else Reflect.deleteProperty(window, "innerWidth");
  }
});

test("narrow Ships starts collapsed and allows deliberate disclosure", async () => {
  const media = spyOn(window, "matchMedia").mockImplementation((query) => ({ matches: query === "(min-width: 1px) and (max-width: 900px)", media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true }));
  const width = Object.getOwnPropertyDescriptor(window, "innerWidth");
  Object.defineProperty(window, "innerWidth", { value: 400, configurable: true });
  const props = { pending: false, retry() {}, onChange() {} };
  const view = renderWithProviders(<ShipsSidebar {...props} />);
  try {
    const details = view.container.querySelector("details")!;
    expect(details.open).toBe(false);
    await act(async () => { details.open = true; fireEvent(details, new Event("toggle")); });
    expect(details.open).toBe(true);
    expect(view.getByText(/Ships/)).toBeTruthy();
  } finally {
    view.unmount(); media.mockRestore();
    if (width) Object.defineProperty(window, "innerWidth", width);
    else Reflect.deleteProperty(window, "innerWidth");
  }
});
