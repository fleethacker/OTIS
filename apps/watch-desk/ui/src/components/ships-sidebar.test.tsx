import "../route-registry";
import { expect, spyOn, test } from "bun:test";
import { act, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "../test-utils/render";
import { ShipsSidebar } from "./ships-sidebar";

test("narrow Ships starts collapsed and deliberate disclosure survives rerenders", async () => {
  const media = spyOn(window, "matchMedia").mockImplementation((query) => ({ matches: query === "(max-width: 900px)", media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true }));
  const props = { pending: false, retry() {}, onChange() {} };
  const view = renderWithProviders(<ShipsSidebar {...props} />);
  try {
    const details = view.container.querySelector("details")!;
    expect(details.open).toBe(false);
    await act(async () => { details.open = true; fireEvent(details, new Event("toggle")); });
    expect(details.open).toBe(true);
    expect(view.getByText(/Ships/)).toBeTruthy();
  } finally { view.unmount(); media.mockRestore(); }
});
