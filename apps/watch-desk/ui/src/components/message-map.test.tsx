import { expect, test } from "bun:test";
import { create } from "@bufbuild/protobuf";
import { fireEvent, within } from "@testing-library/react";
import { MessageRecordSchema } from "../gen/app/v1/models_pb";
import { renderWithProviders } from "../test-utils/render";
import { MessageMap } from "./message-map";
import { MessageReader } from "./message-reader";

const source = (label: string, geometry: Record<string, unknown>) => ({
  label,
  status: "inferred",
  datum: "WGS84",
  datum_source: "explicit",
  ...geometry,
});
const locations = [
  source("Exercise position", { type: "position", point: { lon: -6, lat: 30 } }),
  source("Exercise route", { type: "channel", shape: { type: "LineString", coordinates: [[-8, 29], [-4, 32]] } }),
  source("Exercise area", { type: "area", shape: { type: "Polygon", coordinates: [[[-7, 29], [-5, 29], [-5, 31], [-7, 31], [-7, 29]]] } }),
  source("Exercise circle", { type: "circle_center", point: { lon: -4, lat: 30 }, radius_m: 18520 }),
];
const message = (entries: unknown[] = locations, key = "internal-source-hidden") => create(MessageRecordSchema, {
  sourceMessageId: key,
  structuredPayloadJson: JSON.stringify({ subject: "Map exercise", sets: [], locations: entries }),
});

test("map disclosure is absent for missing, named-only and invalid coordinates", () => {
  const view = renderWithProviders(<MessageMap message={create(MessageRecordSchema)} />);
  expect(view.queryByRole("button", { name: "Map" })).toBeNull();
  view.rerender(<MessageMap message={message([
    { label: "Exercise harbour", status: "unresolved", datum: "WGS84" },
    source("Invalid latitude", { point: { lon: -45, lat: 95 } }),
  ])} />);
  expect(view.queryByRole("button", { name: "Map" })).toBeNull();
  view.rerender(<MessageMap message={create(MessageRecordSchema, { structuredPayloadJson: "broken json" })} />);
  expect(view.queryByRole("region", { name: "Message map" })).toBeNull();
});

test("map opens from a collapsed disclosure and renders all supported geometry with local context", () => {
  const view = renderWithProviders(<MessageMap message={message()} />);
  const toggle = view.getByRole("button", { name: "Map" });
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(view.queryByRole("group", { name: "Message coordinates and shapes" })).toBeNull();
  const panel = view.container.querySelector(`[id="${toggle.getAttribute("aria-controls")}"]`);
  expect(panel?.hasAttribute("hidden")).toBe(true);

  fireEvent.click(toggle);
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  expect(panel?.hasAttribute("hidden")).toBe(false);
  const map = view.getByRole("group", { name: "Message coordinates and shapes" });
  for (const location of locations) {
    const plotted = within(map).getByRole("img", { name: location.label });
    expect(plotted.getAttribute("d")).toMatch(/^M/);
    expect(plotted.getAttribute("d")).not.toMatch(/NaN|Infinity/);
  }
  expect(map.querySelector(".message-map-land")?.getAttribute("d")).toMatch(/^M/);
  expect(map.querySelectorAll(".message-map-graticule line").length).toBeGreaterThan(0);
  expect(view.container.textContent).not.toContain("internal-source-hidden");
  fireEvent.click(toggle);
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(view.queryByRole("group", { name: "Message coordinates and shapes" })).toBeNull();
});

test("zoom, keyboard pan and fit change the plotted view and restore the message extent", () => {
  const view = renderWithProviders(<MessageMap message={message()} />);
  fireEvent.click(view.getByRole("button", { name: "Map" }));
  const route = view.getByRole("img", { name: "Exercise route" });
  const original = route.getAttribute("d");
  fireEvent.click(view.getByRole("button", { name: "Zoom in" }));
  expect(route.getAttribute("d")).not.toBe(original);
  fireEvent.click(view.getByRole("button", { name: "Fit message locations" }));
  expect(route.getAttribute("d")).toBe(original);

  const map = view.getByRole("group", { name: "Message coordinates and shapes" });
  fireEvent.keyDown(map, { key: "ArrowRight" });
  expect(route.getAttribute("d")).not.toBe(original);
  fireEvent.keyDown(map, { key: "Home" });
  expect(route.getAttribute("d")).toBe(original);
  fireEvent.keyDown(map, { key: "-" });
  expect(route.getAttribute("d")).not.toBe(original);
});

test("changing the selected message starts its map collapsed", () => {
  const view = renderWithProviders(<MessageMap message={message()} />);
  fireEvent.click(view.getByRole("button", { name: "Map" }));
  expect(view.getByRole("button", { name: "Map" }).getAttribute("aria-expanded")).toBe("true");
  view.rerender(<MessageMap message={message(locations, "different-internal-source")} />);
  expect(view.getByRole("button", { name: "Map" }).getAttribute("aria-expanded")).toBe("false");
  expect(view.queryByRole("group", { name: "Message coordinates and shapes" })).toBeNull();
});

test("source labels remain escaped and available to keyboard users", () => {
  const label = '<img src=x onerror="alert(1)">';
  const view = renderWithProviders(<MessageMap message={message([
    source(label, { type: "position", point: { lon: -45, lat: 30 } }),
  ])} />);
  fireEvent.click(view.getByRole("button", { name: "Map" }));
  const point = view.getByRole("img", { name: label });
  expect(point.getAttribute("tabindex")).toBe("0");
  fireEvent.focus(point);
  expect(view.getByRole("status").textContent).toBe(label);
  expect(view.container.querySelector("img, script")).toBeNull();
});

test("the disclosure precedes the reader tabs and remains available on each tab", () => {
  const view = renderWithProviders(<MessageReader message={message()} />);
  const disclosure = view.getByRole("region", { name: "Message map" });
  const tabs = view.getByRole("tablist", { name: "Message views" });
  expect(disclosure.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  fireEvent.click(view.getByRole("button", { name: "Map" }));
  fireEvent.click(view.getByRole("tab", { name: "Raw message" }));
  expect(view.getByRole("group", { name: "Message coordinates and shapes" })).toBeTruthy();
  fireEvent.click(view.getByRole("tab", { name: "Lifecycle" }));
  expect(view.getByRole("group", { name: "Message coordinates and shapes" })).toBeTruthy();
});
