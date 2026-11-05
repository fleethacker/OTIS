import { useLayoutEffect, useRef, type RefObject } from "react";
import type { CalendarView } from "./calendar-time";

// Zoom only the time grid. Source timestamps, date selection and slot precision
// are unchanged. A plain wheel scrolls as usual; Ctrl/⌘+wheel (and trackpad pinch,
// which browsers report as ctrlKey wheel) zooms. A native non-passive listener
// prevents browser page zoom for those gestures only.
export function useCalendarZoom(
  root: RefObject<HTMLDivElement | null>,
  view: CalendarView,
  interval: number,
  windowKey: string
) {
  const hourHeight = useRef<number | null>(null);
  useLayoutEffect(() => {
    const container = root.current;
    if (!container || view === "month") {
      return;
    }
    let frame: number | null = null;
    let delta = 0;
    let pointerY = 0;
    const scroller = container.querySelector<HTMLElement>(".rbc-time-content");
    if (!scroller) {
      return;
    }
    function apply(slotHeight: number) {
      if (!container) {
        return;
      }
      container.style.setProperty("--calendar-slot-height", `${slotHeight}px`);
      container.dataset.timeZoom = "true";
      const every = Math.max(1, Math.ceil(28 / slotHeight));
      container
        .querySelectorAll<HTMLElement>(".rbc-time-gutter .rbc-timeslot-group")
        .forEach((group, index) => {
          const label = group.querySelector<HTMLElement>(".rbc-label");
          if (label) {
            label.style.display = index % every === 0 ? "block" : "none";
          }
        });
    }
    if (hourHeight.current !== null) {
      apply((hourHeight.current * interval) / 60);
    }
    function zoom() {
      frame = null;
      if (!scroller || !container) {
        return;
      }
      const slots = container.querySelectorAll(".rbc-time-gutter .rbc-timeslot-group").length;
      const height = scroller.scrollHeight;
      if (slots === 0 || height === 0) {
        delta = 0;
        return;
      }
      const y = Math.max(
        0,
        Math.min(scroller.clientHeight, pointerY - scroller.getBoundingClientRect().top)
      );
      const anchor = (scroller.scrollTop + y) / height;
      const minimum = scroller.clientHeight / slots;
      const maximum = Math.max(minimum, (192 * interval) / 60);
      const next = Math.min(
        maximum,
        Math.max(minimum, (height / slots) * Math.exp(-delta * 0.003))
      );
      delta = 0;
      hourHeight.current = (next * 60) / interval;
      apply(next);
      // Reading the new extent after the CSS update keeps the pointed-to time
      // stationary, including when reaching the fitted-day and close-up bounds.
      scroller.scrollTop = anchor * scroller.scrollHeight - y;
    }
    function wheel(event: WheelEvent) {
      if (
        !(event.ctrlKey || event.metaKey) ||
        event.shiftKey ||
        event.deltaY === 0 ||
        Math.abs(event.deltaX) > Math.abs(event.deltaY)
      ) {
        return;
      }
      event.preventDefault();
      const unit =
        event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? (scroller?.clientHeight ?? 0) : 1;
      delta = Math.max(-240, Math.min(240, delta + event.deltaY * unit));
      pointerY = event.clientY;
      frame ??= requestAnimationFrame(zoom);
    }
    scroller.addEventListener("wheel", wheel, { passive: false });
    return () => {
      scroller.removeEventListener("wheel", wheel);
      if (frame !== null) {
        cancelAnimationFrame(frame);
      }
      container.style.removeProperty("--calendar-slot-height");
      delete container.dataset.timeZoom;
    };
  }, [root, view, interval, windowKey]);
}
