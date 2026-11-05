import { expect, test } from "bun:test";
import { waitFor } from "@testing-library/react";
import { useCallback, useRef } from "react";
import { renderWithProviders } from "../test-utils/render";
import type { CalendarView } from "./calendar-time";
import {
  CalendarPreferencesProvider,
  DEFAULT_CALENDAR_PREFERENCES,
  type CalendarPreferences,
} from "./calendar-preferences";
import type { CalendarPreferenceStorage } from "./calendar-preference-storage";
import { useCalendarZoom } from "./calendar-zoom";
import { DayTimeline } from "./day-timeline";

function ZoomGrid({
  view = "day",
  interval = 60,
  viewportHeight = 480,
  onRender,
}: {
  view?: CalendarView;
  interval?: number;
  viewportHeight?: number;
  onRender?: () => void;
}) {
  const root = useRef<HTMLDivElement | null>(null);
  const attach = useCallback(
    (node: HTMLDivElement | null) => {
      root.current = node;
      const scroller = node?.querySelector<HTMLElement>(".rbc-time-content");
      if (!node || !scroller) return;
      Object.defineProperty(scroller, "clientHeight", {
        configurable: true,
        value: viewportHeight,
      });
      Object.defineProperty(scroller, "scrollHeight", {
        configurable: true,
        get: () =>
          Math.max(
            viewportHeight,
            (Number.parseFloat(node.style.getPropertyValue("--calendar-slot-height")) || 44) *
              node.querySelectorAll(".rbc-time-gutter .rbc-timeslot-group").length
          ),
      });
      scroller.getBoundingClientRect = () => ({ top: 100 }) as DOMRect;
    },
    [viewportHeight]
  );
  useCalendarZoom(root, view, interval, "same-day");
  onRender?.();
  return (
    <div ref={attach} className="zoom-test-grid">
      <div className="rbc-time-content">
        <div className="rbc-time-gutter">
          {Array.from({ length: (24 * 60) / interval }, (_, index) => (
            <div className="rbc-timeslot-group" key={index}>
              <span className="rbc-label">{index}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

async function zoomGrid(root: HTMLElement, deltaY: number) {
  const event = new WheelEvent("wheel", { deltaY, bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    clientY: { value: 220 },
    metaKey: { value: true },
  });
  root.querySelector(".rbc-time-content")!.dispatchEvent(event);
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  return Number.parseFloat(root.style.getPropertyValue("--calendar-slot-height"));
}

function zoomStorage(initial: Partial<CalendarPreferences> = {}) {
  let saved = { ...DEFAULT_CALENDAR_PREFERENCES, ...initial };
  const writes: CalendarPreferences[] = [];
  const storage: CalendarPreferenceStorage = {
    read: async () => saved,
    write: async (_scope, preferences) => {
      saved = preferences;
      writes.push(preferences);
    },
  };
  return { storage, writes };
}

for (const view of ["day", "week"] as const) {
  test(`${view} wheel zoom anchors the pointed time and bounds the scale`, async () => {
    const rendered = renderWithProviders(
      <DayTimeline
        messages={[]}
        from={Date.UTC(2008, 3, 1)}
        to={Date.UTC(2008, 3, view === "week" ? 8 : 2)}
        interval={60}
        returnTo="/calendar"
        view={view}
      />
    );
    const root = rendered.container.querySelector<HTMLElement>(".calendar-scroll")!;
    const scroller = root.querySelector<HTMLElement>(".rbc-time-content")!;
    const slots = root.querySelectorAll(".rbc-time-gutter .rbc-timeslot-group").length;
    Object.defineProperty(scroller, "clientHeight", { value: 480 });
    Object.defineProperty(scroller, "scrollHeight", {
      get: () =>
        Math.max(
          480,
          (Number.parseFloat(root.style.getPropertyValue("--calendar-slot-height")) || 44) * slots
        ),
    });
    scroller.getBoundingClientRect = () => ({ top: 100 }) as DOMRect;
    scroller.scrollTop = 200;
    const before = (scroller.scrollTop + 120) / scroller.scrollHeight;
    const wheel = (deltaY: number, extra = {}) => {
      const event = new WheelEvent("wheel", {
        deltaY,
        clientY: 220,
        bubbles: true,
        cancelable: true,
        ...extra,
      });
      // Happy DOM does not copy MouseEvent coordinates into WheelEvent.
      Object.defineProperty(event, "clientY", { value: 220 });
      for (const [key, value] of Object.entries(extra)) {
        Object.defineProperty(event, key, { value });
      }
      scroller.dispatchEvent(event);
      return event;
    };
    const zoom = { ctrlKey: true };
    expect(wheel(-120, zoom).defaultPrevented).toBe(true);
    await waitFor(() =>
      expect(
        Number.parseFloat(root.style.getPropertyValue("--calendar-slot-height"))
      ).toBeGreaterThan(44)
    );
    expect((scroller.scrollTop + 120) / scroller.scrollHeight).toBeCloseTo(before, 6);
    const current = root.style.getPropertyValue("--calendar-slot-height");
    // A plain wheel scrolls the grid; only Ctrl/⌘ (or pinch) zooms.
    expect(wheel(-120).defaultPrevented).toBe(false);
    expect(wheel(-120, { ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(false);
    expect(wheel(-10, { ctrlKey: true, deltaX: 120 }).defaultPrevented).toBe(false);
    expect(root.style.getPropertyValue("--calendar-slot-height")).toBe(current);
    for (let index = 0; index < 5; index += 1) {
      wheel(-240, zoom);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    expect(Number.parseFloat(root.style.getPropertyValue("--calendar-slot-height"))).toBe(192);
    for (let index = 0; index < 5; index += 1) {
      wheel(240, zoom);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    expect(Number.parseFloat(root.style.getPropertyValue("--calendar-slot-height"))).toBeCloseTo(
      480 / slots
    );
    rendered.unmount();
    expect(wheel(-120, zoom).defaultPrevented).toBe(false);
  });
}

test("month and calendar controls retain ordinary wheel behavior", () => {
  const rendered = renderWithProviders(
    <DayTimeline
      messages={[]}
      from={Date.UTC(2008, 3, 1)}
      to={Date.UTC(2008, 4, 1)}
      interval={60}
      returnTo="/calendar"
      view="month"
    />
  );
  const root = rendered.container.querySelector<HTMLElement>(".calendar-scroll")!;
  const wheel = new WheelEvent("wheel", { deltaY: -120, bubbles: true, cancelable: true });
  root.dispatchEvent(wheel);
  expect(wheel.defaultPrevented).toBe(false);
  expect(root.dataset.timeZoom).toBeUndefined();
});

test("zoom commits after wheel input settles without changing the anchored grid", async () => {
  const { storage, writes } = zoomStorage({ dayHourHeight: 80 });
  let renders = 0;
  const rendered = renderWithProviders(
    <CalendarPreferencesProvider scope="zoom-debounce" storage={storage}>
      <ZoomGrid onRender={() => (renders += 1)} />
    </CalendarPreferencesProvider>
  );
  await waitFor(() => expect(rendered.container.querySelector(".zoom-test-grid")).not.toBeNull());
  const root = rendered.container.querySelector<HTMLElement>(".zoom-test-grid")!;
  const scroller = root.querySelector<HTMLElement>(".rbc-time-content")!;
  const initialWrites = writes.length;
  const initialRenders = renders;
  scroller.scrollTop = 200;
  const anchor = (scroller.scrollTop + 120) / scroller.scrollHeight;
  await zoomGrid(root, -60);
  const next = await zoomGrid(root, -60);
  expect(writes).toHaveLength(initialWrites);
  expect(renders).toBe(initialRenders);
  await waitFor(() => expect(writes.at(-1)?.dayHourHeight).toBeCloseTo(next, 6));
  expect(writes).toHaveLength(initialWrites + 1);
  expect(Number.parseFloat(root.style.getPropertyValue("--calendar-slot-height"))).toBeCloseTo(next, 6);
  expect((scroller.scrollTop + 120) / scroller.scrollHeight).toBeCloseTo(anchor, 6);
});

test("day and week restore separate scales and preserve the time position when interval changes", async () => {
  const { storage } = zoomStorage({ dayHourHeight: 80, weekHourHeight: 120 });
  const pane = (view: CalendarView, interval = 60) => (
    <CalendarPreferencesProvider scope="zoom-scales" storage={storage}>
      <ZoomGrid view={view} interval={interval} />
    </CalendarPreferencesProvider>
  );
  const rendered = renderWithProviders(pane("day"));
  await waitFor(() => expect(rendered.container.querySelector(".zoom-test-grid")).not.toBeNull());
  const root = rendered.container.querySelector<HTMLElement>(".zoom-test-grid")!;
  expect(Number.parseFloat(root.style.getPropertyValue("--calendar-slot-height"))).toBe(80);
  rendered.rerender(pane("week"));
  expect(Number.parseFloat(root.style.getPropertyValue("--calendar-slot-height"))).toBe(120);
  const scroller = root.querySelector<HTMLElement>(".rbc-time-content")!;
  scroller.scrollTop = 200;
  const anchor = scroller.scrollTop / scroller.scrollHeight;
  rendered.rerender(pane("week", 30));
  expect(Number.parseFloat(root.style.getPropertyValue("--calendar-slot-height"))).toBe(60);
  expect(scroller.scrollTop / scroller.scrollHeight).toBeCloseTo(anchor, 6);
  rendered.rerender(pane("day", 30));
  expect(Number.parseFloat(root.style.getPropertyValue("--calendar-slot-height"))).toBe(40);
});

test("restored scale stays within the viewport and close-up bounds", async () => {
  const { storage } = zoomStorage({ dayHourHeight: 4096, weekHourHeight: 5 });
  const pane = (view: CalendarView) => (
    <CalendarPreferencesProvider scope="zoom-bounds" storage={storage}>
      <ZoomGrid view={view} interval={30} viewportHeight={960} />
    </CalendarPreferencesProvider>
  );
  const rendered = renderWithProviders(pane("day"));
  await waitFor(() => expect(rendered.container.querySelector(".zoom-test-grid")).not.toBeNull());
  const root = rendered.container.querySelector<HTMLElement>(".zoom-test-grid")!;
  expect(Number.parseFloat(root.style.getPropertyValue("--calendar-slot-height"))).toBe(96);
  rendered.rerender(pane("week"));
  expect(Number.parseFloat(root.style.getPropertyValue("--calendar-slot-height"))).toBe(960 / 48);
});

test("leaving the calendar flushes a pending scale and the next visit restores it", async () => {
  const { storage, writes } = zoomStorage({ dayHourHeight: 80, weekHourHeight: 120 });
  const pane = (show: boolean) => (
    <CalendarPreferencesProvider scope="zoom-navigation" storage={storage}>
      {show && <ZoomGrid />}
    </CalendarPreferencesProvider>
  );
  const rendered = renderWithProviders(pane(true));
  await waitFor(() => expect(rendered.container.querySelector(".zoom-test-grid")).not.toBeNull());
  const root = rendered.container.querySelector<HTMLElement>(".zoom-test-grid")!;
  const initialWrites = writes.length;
  const next = await zoomGrid(root, -60);
  expect(writes).toHaveLength(initialWrites);
  rendered.rerender(pane(false));
  await waitFor(() => expect(writes.at(-1)?.dayHourHeight).toBeCloseTo(next, 6));
  expect(writes.at(-1)?.weekHourHeight).toBe(120);
  rendered.unmount();
  const restored = renderWithProviders(pane(true));
  await waitFor(() => {
    const grid = restored.container.querySelector<HTMLElement>(".zoom-test-grid");
    expect(Number.parseFloat(grid?.style.getPropertyValue("--calendar-slot-height") ?? "")).toBeCloseTo(next, 6);
  });
});
