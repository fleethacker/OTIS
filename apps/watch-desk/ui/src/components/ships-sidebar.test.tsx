import "../route-registry";
import { expect, spyOn, test } from "bun:test";
import { useState } from "react";
import { fireEvent } from "@testing-library/react";
import { renderWithProviders } from "../test-utils/render";
import type { CommandRoster } from "./command-roster";
import { ShipsSidebar } from "./ships-sidebar";

const defaults = { pending: false, retry() {}, onChange() {}, onReset() {} };
const roster: CommandRoster = {
  commands: [
    { id: "meridian", name: "USS Meridian", shortLabel: "MERIDIAN", group: "Escort group", colorIndex: 0, isOwnShip: true },
    ...["Halyard", "Tern", "Beacon", "Crest", "Dory", "Finch"].map((name, index) => ({
      id: name.toLowerCase(), name: `USS ${name}`, shortLabel: name.toUpperCase(),
      group: "Escort group", colorIndex: index % 4, isOwnShip: false,
    })),
  ],
  source: "fictional-test", version: "1", provenance: "Fictional demo", assignmentEnabled: true,
  defaultShips: ["unit:meridian"],
};

test("Ships defaults closed when the viewport is not established", () => {
  const media = spyOn(window, "matchMedia").mockImplementation((query) => ({ matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true }));
  const view = renderWithProviders(<ShipsSidebar {...defaults} />);
  try { expect(view.getByRole("button", { name: "Expand ship calendars" })).toHaveAttribute("aria-expanded", "false"); }
  finally { view.unmount(); media.mockRestore(); }
});

test("zero-width and desktop layouts both start with Ships closed", () => {
  const width = Object.getOwnPropertyDescriptor(window, "innerWidth");
  const media = spyOn(window, "matchMedia").mockImplementation((query) => ({ matches: true, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true }));
  try {
    for (const value of [0, 1024]) {
      Object.defineProperty(window, "innerWidth", { value, configurable: true });
      const view = renderWithProviders(<ShipsSidebar {...defaults} />);
      expect(view.getByRole("button", { name: "Expand ship calendars" })).toHaveAttribute("aria-expanded", "false");
      view.unmount();
    }
  } finally {
    media.mockRestore();
    if (width) Object.defineProperty(window, "innerWidth", width);
    else Reflect.deleteProperty(window, "innerWidth");
  }
});

test("narrow Ships starts collapsed and allows deliberate disclosure", () => {
  const media = spyOn(window, "matchMedia").mockImplementation((query) => ({ matches: query === "(min-width: 1px) and (max-width: 900px)", media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true }));
  const width = Object.getOwnPropertyDescriptor(window, "innerWidth");
  Object.defineProperty(window, "innerWidth", { value: 400, configurable: true });
  const view = renderWithProviders(<ShipsSidebar {...defaults} roster={roster} />);
  try {
    const toggle = view.getByRole("button", { name: "Expand ship calendars" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(view.queryByRole("checkbox", { name: "USS Meridian" })).toBeNull();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(view.getByRole("checkbox", { name: "USS Meridian" })).toBeTruthy();
  } finally {
    view.unmount(); media.mockRestore();
    if (width) Object.defineProperty(window, "innerWidth", width);
    else Reflect.deleteProperty(window, "innerWidth");
  }
});

test("collapsing preserves search and selection without changing the filter", () => {
  let changes = 0;
  const view = renderWithProviders(<ShipsSidebar {...defaults} roster={roster}
    selected={new Set(["unit:halyard"])} onChange={() => { changes += 1; }} />);
  try {
    fireEvent.click(view.getByRole("button", { name: "Expand ship calendars" }));
    fireEvent.change(view.getByRole("searchbox", { name: "Find ship" }), { target: { value: "Halyard" } });
    const toggle = view.getByRole("button", { name: "Collapse ship calendars" });
    const panelId = toggle.getAttribute("aria-controls");
    expect(panelId).toBeTruthy();
    expect(document.getElementById(panelId!)).toBeTruthy();
    fireEvent.click(toggle);
    expect(view.queryByRole("searchbox", { name: "Find ship" })).toBeNull();
    expect(view.queryByRole("checkbox", { name: "USS Halyard" })).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "Expand ship calendars" }));
    expect(view.getByRole("searchbox", { name: "Find ship" })).toHaveValue("Halyard");
    expect(view.getByRole("checkbox", { name: "USS Halyard" })).toBeChecked();
    expect(changes).toBe(0);
  } finally { view.unmount(); }
});

test("overflow keeps All, None and Defaults distinct and returns focus on Escape", () => {
  const changes: (string[] | undefined)[] = [];
  let resets = 0;
  const view = renderWithProviders(<ShipsSidebar {...defaults} roster={roster}
    onChange={(selection) => changes.push(selection === undefined ? undefined : [...selection])}
    onReset={() => { resets += 1; }} />);
  try {
    fireEvent.click(view.getByRole("button", { name: "Expand ship calendars" }));
    const trigger = view.getByRole("button", { name: "Ship calendar options" });
    fireEvent.click(trigger);
    const all = view.getByRole("button", { name: "Select all" });
    expect(document.activeElement).toBe(all);
    fireEvent.keyDown(all, { key: "Escape" });
    expect(view.queryByRole("dialog", { name: "Ship calendar options" })).toBeNull();
    expect(document.activeElement).toBe(trigger);
    for (const action of ["Select all", "Clear all", "Use app defaults"]) {
      fireEvent.click(trigger);
      fireEvent.click(view.getByRole("button", { name: action }));
      expect(view.queryByRole("dialog", { name: "Ship calendar options" })).toBeNull();
    }
    expect(changes).toEqual([undefined, []]);
    expect(resets).toBe(1);
  } finally { view.unmount(); }
});

test("group toggles preserve unknown selections, partial states, and hidden search matches", () => {
  let latest = new Set(["unit:halyard", "unit:outside-roster"]);
  function ControlledSidebar() {
    const [selected, setSelected] = useState(latest);
    return <ShipsSidebar {...defaults} roster={roster} selected={selected} onChange={(next) => {
      latest = next ?? new Set();
      setSelected(latest);
    }} />;
  }
  const view = renderWithProviders(<ControlledSidebar />);
  try {
    fireEvent.click(view.getByRole("button", { name: "Expand ship calendars" }));
    const group = view.getByRole("checkbox", { name: "Escort group" }) as HTMLInputElement;
    expect(group.indeterminate).toBe(true);
    fireEvent.click(group);
    expect(group).toBeChecked();
    expect(group.indeterminate).toBe(false);
    expect(latest.has("unit:outside-roster")).toBe(true);
    expect(latest.has("unit:meridian")).toBe(false);
    fireEvent.change(view.getByRole("searchbox", { name: "Find ship" }), { target: { value: "Halyard" } });
    fireEvent.click(view.getByRole("checkbox", { name: "Escort group" }));
    expect(latest.has("unit:halyard")).toBe(false);
    expect(latest.has("unit:tern")).toBe(true);
    expect(latest.has("unit:outside-roster")).toBe(true);
    fireEvent.change(view.getByRole("searchbox", { name: "Find ship" }), { target: { value: "" } });
    expect((view.getByRole("checkbox", { name: "Escort group" }) as HTMLInputElement).indeterminate).toBe(true);
    fireEvent.click(view.getByRole("button", { name: "Only Unassigned" }));
    expect([...latest]).toEqual(["unassigned:"]);
    expect(view.getByRole("checkbox", { name: "Unassigned", exact: true })).toBeChecked();
  } finally { view.unmount(); }
});

test("roster failure keeps the retry action accessible", () => {
  let retries = 0;
  const view = renderWithProviders(<ShipsSidebar {...defaults} error="Unavailable" retry={() => { retries += 1; }} />);
  try {
    fireEvent.click(view.getByRole("button", { name: "Expand ship calendars" }));
    expect(view.getByRole("alert")).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Retry roster" }));
    expect(retries).toBe(1);
  } finally { view.unmount(); }
});
