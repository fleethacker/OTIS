import { expect, test } from "bun:test";
import { act, fireEvent, waitFor } from "@testing-library/react";
import { useLayoutEffect, type Dispatch, type SetStateAction } from "react";
import { renderWithProviders } from "../test-utils/render";
import {
  CalendarPreferencesProvider,
  DEFAULT_CALENDAR_PREFERENCES,
  useCalendarPreference,
  type CalendarPreferences,
} from "./calendar-preferences";
import type { CalendarPreferenceStorage } from "./calendar-preference-storage";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function PreferenceControls({ onView, capture }: {
  onView?: (view: CalendarPreferences["view"]) => void;
  capture?: (setView: Dispatch<SetStateAction<CalendarPreferences["view"]>>) => void;
}) {
  const [view, setView] = useCalendarPreference("view");
  const [shipsOpen, setShipsOpen] = useCalendarPreference("shipsOpen");
  onView?.(view);
  capture?.(setView);
  return <>
    <output aria-label="Calendar view">{view}</output>
    <button onClick={() => setView("week")}>Week</button>
    <button aria-expanded={shipsOpen} onClick={() => setShipsOpen((value) => !value)}>Ships</button>
  </>;
}

test("calendar hydration gates children and never saves defaults over a delayed read", async () => {
  const pending = deferred<CalendarPreferences | undefined>();
  const reads: string[] = [];
  const writes: { scope: string; value: CalendarPreferences }[] = [];
  const renderedViews: string[] = [];
  const storage: CalendarPreferenceStorage = {
    read(scope) { reads.push(scope); return pending.promise; },
    async write(scope, value) { writes.push({ scope, value }); },
  };
  const rendered = renderWithProviders(
    <CalendarPreferencesProvider scope="alice" storage={storage} defaultView="week">
      <PreferenceControls onView={(view) => renderedViews.push(view)} />
    </CalendarPreferencesProvider>
  );
  try {
    expect(rendered.getByRole("status").textContent).toBe("Loading calendar…");
    expect(rendered.queryByRole("button", { name: "Week" })).toBeNull();
    expect(reads).toEqual(["alice"]);
    expect(renderedViews).toEqual([]);
    expect(writes).toEqual([]);
    await act(async () => pending.resolve({ ...DEFAULT_CALENDAR_PREFERENCES, view: "month", shipsOpen: true }));
    expect(rendered.getByLabelText("Calendar view").textContent).toBe("month");
    expect(rendered.getByRole("button", { name: "Ships" })).toHaveAttribute("aria-expanded", "true");
    expect(renderedViews.every((view) => view === "month")).toBe(true);
    expect(writes).toEqual([]);
    fireEvent.click(rendered.getByRole("button", { name: "Ships" }));
    expect(rendered.getByRole("button", { name: "Ships" })).toHaveAttribute("aria-expanded", "false");
    expect(writes).toEqual([{ scope: "alice", value: { ...DEFAULT_CALENDAR_PREFERENCES, view: "month" } }]);
  } finally { rendered.unmount(); }
});

test("unavailable browser storage leaves calendar preferences usable in memory", async () => {
  const writes: CalendarPreferences[] = [];
  const storage: CalendarPreferenceStorage = {
    async read() { throw new Error("storage unavailable"); },
    async write(_scope, value) { writes.push(value); throw new Error("quota exceeded"); },
  };
  const rendered = renderWithProviders(
    <CalendarPreferencesProvider scope="alice" storage={storage}>
      <PreferenceControls />
    </CalendarPreferencesProvider>
  );
  try {
    await waitFor(() => expect(rendered.getByLabelText("Calendar view").textContent).toBe("day"));
    expect(writes).toEqual([]);
    expect(rendered.getByRole("button", { name: "Ships" })).toHaveAttribute("aria-expanded", "false");
    await act(async () => {
      fireEvent.click(rendered.getByRole("button", { name: "Week" }));
      fireEvent.click(rendered.getByRole("button", { name: "Ships" }));
    });
    expect(rendered.getByLabelText("Calendar view").textContent).toBe("week");
    expect(rendered.getByRole("button", { name: "Ships" })).toHaveAttribute("aria-expanded", "true");
    expect(writes).toHaveLength(2);
    expect(writes.at(-1)).toMatchObject({ view: "week", shipsOpen: true });
    expect(rendered.queryByText("Loading calendar…")).toBeNull();
  } finally { rendered.unmount(); }
});

test("account switching ignores stale hydration and writes only the newly loaded scope", async () => {
  const alice = deferred<CalendarPreferences | undefined>();
  const bob = deferred<CalendarPreferences | undefined>();
  const writes: { scope: string; value: CalendarPreferences }[] = [];
  const storage: CalendarPreferenceStorage = {
    read(scope) { return scope === "alice" ? alice.promise : bob.promise; },
    async write(scope, value) { writes.push({ scope, value }); },
  };
  const pane = (scope: string) => <CalendarPreferencesProvider scope={scope} storage={storage}>
    <PreferenceControls />
  </CalendarPreferencesProvider>;
  const rendered = renderWithProviders(pane("alice"));
  try {
    rendered.rerender(pane("bob"));
    await act(async () => alice.resolve({ ...DEFAULT_CALENDAR_PREFERENCES, view: "week", shipsOpen: true }));
    expect(rendered.getByRole("status")).toBeTruthy();
    expect(rendered.queryByLabelText("Calendar view")).toBeNull();
    expect(writes).toEqual([]);
    await act(async () => bob.resolve({ ...DEFAULT_CALENDAR_PREFERENCES, view: "month" }));
    expect(rendered.getByLabelText("Calendar view").textContent).toBe("month");
    expect(rendered.getByRole("button", { name: "Ships" })).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(rendered.getByRole("button", { name: "Week" }));
    expect(writes).toEqual([{ scope: "bob", value: { ...DEFAULT_CALENDAR_PREFERENCES, view: "week" } }]);
  } finally { rendered.unmount(); }
});

test("callbacks retained after an account switch cannot update the departed account", async () => {
  const writes: { scope: string; value: CalendarPreferences }[] = [];
  let staleUpdate: Dispatch<SetStateAction<CalendarPreferences["view"]>> | undefined;
  const storage: CalendarPreferenceStorage = {
    async read(scope) { return { ...DEFAULT_CALENDAR_PREFERENCES, view: scope === "alice" ? "day" : "month" }; },
    async write(scope, value) { writes.push({ scope, value }); },
  };
  const pane = (scope: string) => <CalendarPreferencesProvider scope={scope} storage={storage}>
    <PreferenceControls capture={scope === "alice" ? (update) => { staleUpdate = update; } : undefined} />
  </CalendarPreferencesProvider>;
  const rendered = renderWithProviders(pane("alice"));
  try {
    await rendered.findByLabelText("Calendar view");
    expect(staleUpdate).toBeDefined();
    rendered.rerender(pane("bob"));
    await waitFor(() => expect(rendered.getByLabelText("Calendar view").textContent).toBe("month"));
    await act(async () => staleUpdate?.("week"));
    expect(writes).toEqual([]);
    expect(rendered.getByLabelText("Calendar view").textContent).toBe("month");
    fireEvent.click(rendered.getByRole("button", { name: "Ships" }));
    expect(writes).toEqual([{ scope: "bob", value: { ...DEFAULT_CALENDAR_PREFERENCES, view: "month", shipsOpen: true } }]);
  } finally { rendered.unmount(); }
});

test("layout cleanup can flush pending zoom before the preference session unmounts", async () => {
  const writes: { scope: string; value: CalendarPreferences }[] = [];
  const storage: CalendarPreferenceStorage = {
    async read() { return { ...DEFAULT_CALENDAR_PREFERENCES, dayHourHeight: 80 }; },
    async write(scope, value) { writes.push({ scope, value }); },
  };
  function PendingZoom() {
    const [height, saveHeight] = useCalendarPreference("dayHourHeight");
    useLayoutEffect(() => () => saveHeight(120), [saveHeight]);
    return <output aria-label="Zoom scale">{height}</output>;
  }
  const rendered = renderWithProviders(
    <CalendarPreferencesProvider scope="alice" storage={storage}>
      <PendingZoom />
    </CalendarPreferencesProvider>
  );
  await rendered.findByLabelText("Zoom scale");
  expect(writes).toEqual([]);
  rendered.unmount();
  expect(writes).toEqual([{ scope: "alice", value: { ...DEFAULT_CALENDAR_PREFERENCES, dayHourHeight: 120 } }]);
});
