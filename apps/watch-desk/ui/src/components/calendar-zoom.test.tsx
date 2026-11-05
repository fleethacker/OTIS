import { expect, test } from "bun:test";
import { waitFor } from "@testing-library/react";
import { renderWithProviders } from "../test-utils/render";
import { DayTimeline } from "./day-timeline";

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
    expect(wheel(-120).defaultPrevented).toBe(true);
    await waitFor(() =>
      expect(
        Number.parseFloat(root.style.getPropertyValue("--calendar-slot-height"))
      ).toBeGreaterThan(44)
    );
    expect((scroller.scrollTop + 120) / scroller.scrollHeight).toBeCloseTo(before, 6);
    const current = root.style.getPropertyValue("--calendar-slot-height");
    expect(wheel(-120, { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(wheel(-120, { metaKey: true }).defaultPrevented).toBe(false);
    expect(wheel(-120, { shiftKey: true }).defaultPrevented).toBe(false);
    expect(wheel(-10, { deltaX: 120 }).defaultPrevented).toBe(false);
    expect(root.style.getPropertyValue("--calendar-slot-height")).toBe(current);
    for (let index = 0; index < 5; index += 1) {
      wheel(-240);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    expect(Number.parseFloat(root.style.getPropertyValue("--calendar-slot-height"))).toBe(192);
    for (let index = 0; index < 5; index += 1) {
      wheel(240);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    expect(Number.parseFloat(root.style.getPropertyValue("--calendar-slot-height"))).toBeCloseTo(
      480 / slots
    );
    rendered.unmount();
    expect(wheel(-120).defaultPrevented).toBe(false);
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
