import "../route-registry";
import { expect, test } from "bun:test";
import { act, fireEvent, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { renderWithProviders } from "../test-utils/render";
import { CalendarParamsProvider, calendarPreferencesFromParams, initialCalendarParams, useCalendarParams } from "./calendar-params";
import { CalendarPreferencesProvider, DEFAULT_CALENDAR_PREFERENCES } from "./calendar-preferences";

function Controls() {
  const [params, update] = useCalendarParams();
  const location = useLocation();
  const navigate = useNavigate();
  return <>
    <input aria-label="Search" value={params.get("q") ?? ""} onChange={(e) => update((p) => p.set("q", e.target.value), true)} />
    <button onClick={() => update((p) => p.set("view", "week"))}>Week</button>
    <button onClick={() => { void navigate(-1); }}>Back</button>
    <output>{location.search}</output>
  </>;
}
test("burst typing and a same-turn view change preserve the latest query and other parameters", async () => {
  const view = renderWithProviders(<Controls />, { route: '/calendar?date=2026-11-05&ships=%5B%5D&shipLayout=side' });
  const input = view.getByLabelText("Search") as HTMLInputElement;
  try {
    // No waits between characters; append to the actual controlled DOM value.
    await act(async () => {
      for (const character of "communications") fireEvent.change(input, { target: { value: input.value + character } });
      fireEvent.click(view.getByText("Week"));
    });
    await waitFor(() => expect(view.container.querySelector("output")!.textContent).toContain("q=communications"));
    expect(input).toHaveValue("communications");
    expect(view.container.querySelector("output")!.textContent).toContain("ships=%5B%5D");
    expect(view.container.querySelector("output")!.textContent).toContain("shipLayout=side");
    await act(async () => { fireEvent.click(view.getByText("Back")); });
    await waitFor(() => expect(view.container.querySelector("output")!.textContent).not.toContain("view=week"));
    expect(input).toHaveValue("communications");
    await act(async () => { fireEvent.change(input, { target: { value: "radio rehearsal" } }); });
    await waitFor(() => expect(view.container.querySelector("output")!.textContent).toContain("q=radio+rehearsal"));
    await act(async () => { fireEvent.change(input, { target: { value: "" } }); });
    await waitFor(() => expect(input).toHaveValue(""));
  } finally { view.unmount(); }
});

test("saved presentation restores without carrying a date or query and explicit links take priority", () => {
  const saved = { ...DEFAULT_CALENDAR_PREFERENCES, view: "month" as const, interval: "30" as const,
    ships: '["unit:alpha"]', shipLayout: "side" as const, layout: "expanded" as const,
    turnoverOpen: true, turnoverChoice: "2026-11-04T08:00:00Z" };
  const restored = initialCalendarParams("", saved);
  expect(restored.get("view")).toBe("month");
  expect(restored.get("interval")).toBe("30");
  expect(restored.get("ships")).toBe(saved.ships);
  expect(restored.get("shipLayout")).toBe("side");
  expect(restored.get("layout")).toBe("expanded");
  expect(restored.has("date")).toBe(false);
  expect(restored.has("q")).toBe(false);
  for (const selection of ["[]", "invalid", '["unit:unavailable"]']) {
    const link = new URLSearchParams({ view: "day", date: "2008-04-01", q: "radio", interval: "60",
      ships: selection, shipLayout: "combined", layout: "fit", since: "closed:auto" });
    expect(initialCalendarParams(link.toString(), saved).toString()).toBe(link.toString());
  }
  const next = calendarPreferencesFromParams(new URLSearchParams("view=week&date=2008-01-01&q=private"), saved);
  expect(next.ships).toBeNull(); // Defaults follows the shared setting, not the old explicit selection.
  expect(next).not.toHaveProperty("date");
  expect(next).not.toHaveProperty("q");
});

function DisclosureControl() {
  const [params, update] = useCalendarParams();
  return <button aria-pressed={params.get("since") === "auto"}
    onClick={() => update((p) => p.set("since", "auto"))}>Open watch</button>;
}

test("hydrated controls share a synchronous URL writer and Back restores the prior view", async () => {
  const writes: unknown[] = [];
  const storage = {
    read: async () => ({ ...DEFAULT_CALENDAR_PREFERENCES, view: "month" as const, ships: "[]" }),
    write: async (_scope: string, value: unknown) => { writes.push(value); },
  };
  const view = renderWithProviders(<StrictMode><CalendarPreferencesProvider scope="viewer" storage={storage}>
    <CalendarParamsProvider><Controls /><DisclosureControl /></CalendarParamsProvider>
  </CalendarPreferencesProvider></StrictMode>, { route: "/calendar" });
  try {
    await waitFor(() => expect(view.container.querySelector("output")?.textContent).toContain("view=month"));
    expect(writes).toHaveLength(0);
    const input = view.getByLabelText("Search");
    await act(async () => {
      fireEvent.change(input, { target: { value: "radio watch" } });
      fireEvent.click(view.getByText("Open watch"));
    });
    await waitFor(() => expect(view.container.querySelector("output")?.textContent).toContain("since=auto"));
    expect(view.container.querySelector("output")?.textContent).toContain("q=radio+watch");
    expect(view.container.querySelector("output")?.textContent).toContain("ships=%5B%5D");
    fireEvent.click(view.getByText("Week"));
    await waitFor(() => expect(view.container.querySelector("output")?.textContent).toContain("view=week"));
    fireEvent.click(view.getByText("Back"));
    await waitFor(() => expect(view.container.querySelector("output")?.textContent).toContain("view=month"));
    expect(input).toHaveValue("radio watch");
  } finally { view.unmount(); }
});
