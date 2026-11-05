import { useLayoutEffect, useRef, type RefObject } from "react";
import type { CalendarView } from "./calendar-time";
import { useCalendarPreference } from "./calendar-preferences";

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
  const [dayHourHeight, setDayHourHeight] = useCalendarPreference("dayHourHeight");
  const [weekHourHeight, setWeekHourHeight] = useCalendarPreference("weekHourHeight");
  const hourHeights = useRef({ day: dayHourHeight, week: weekHourHeight });
  const saveHeight = useRef({ day: setDayHourHeight, week: setWeekHourHeight });
  const scrollAnchor = useRef<{ view: CalendarView; windowKey: string; hourOffset: number } | null>(
    null
  );
  // Keep pending wheel changes in refs. A preference write must not reinstall
  // the listener or reset the grid while the user is still zooming.
  useLayoutEffect(() => {
    hourHeights.current.day = dayHourHeight;
  }, [dayHourHeight]);
  useLayoutEffect(() => {
    hourHeights.current.week = weekHourHeight;
  }, [weekHourHeight]);
  useLayoutEffect(() => {
    saveHeight.current = { day: setDayHourHeight, week: setWeekHourHeight };
  }, [setDayHourHeight, setWeekHourHeight]);
  useLayoutEffect(() => {
    const container = root.current;
    if (!container || view === "month") {
      return;
    }
    let frame: number | null = null;
    let commitTimer: ReturnType<typeof setTimeout> | null = null;
    let pendingHeight: number | null = null;
    let delta = 0;
    let pointerY = 0;
    const scroller = container.querySelector<HTMLElement>(".rbc-time-content");
    if (!scroller) {
      return;
    }
    function clampScale(slotHeight: number, slots: number) {
      const minimum = (scroller?.clientHeight ?? 0) / slots;
      const maximum = Math.max(minimum, (192 * interval) / 60);
      return Math.min(maximum, Math.max(minimum, slotHeight));
    }
    function commit() {
      commitTimer = null;
      if (pendingHeight !== null && view !== "month") {
        const value = pendingHeight;
        pendingHeight = null;
        saveHeight.current[view](value);
      }
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
    const remembered = hourHeights.current[view];
    const slots = container.querySelectorAll(".rbc-time-gutter .rbc-timeslot-group").length;
    let appliedHourHeight = slots > 0 ? (scroller.scrollHeight * 60) / (slots * interval) : 0;
    if (remembered !== null && Number.isFinite(remembered) && remembered > 0 && slots > 0) {
      const previous = scrollAnchor.current;
      const hourOffset =
        previous?.view === view && previous.windowKey === windowKey
          ? previous.hourOffset
          : appliedHourHeight > 0
            ? scroller.scrollTop / appliedHourHeight
            : 0;
      apply(clampScale((remembered * interval) / 60, slots));
      appliedHourHeight = (scroller.scrollHeight * 60) / (slots * interval);
      scroller.scrollTop = hourOffset * appliedHourHeight;
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
      const next = clampScale((height / slots) * Math.exp(-delta * 0.003), slots);
      delta = 0;
      pendingHeight = (next * 60) / interval;
      if (view !== "month") {
        hourHeights.current[view] = pendingHeight;
      }
      apply(next);
      // Reading the new extent after the CSS update keeps the pointed-to time
      // stationary, including when reaching the fitted-day and close-up bounds.
      scroller.scrollTop = anchor * scroller.scrollHeight - y;
      appliedHourHeight = (scroller.scrollHeight * 60) / (slots * interval);
      if (commitTimer !== null) {
        clearTimeout(commitTimer);
      }
      commitTimer = setTimeout(commit, 150);
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
      if (commitTimer !== null) {
        clearTimeout(commitTimer);
      }
      commit();
      scrollAnchor.current = {
        view,
        windowKey,
        // React may already have replaced the time slots for a new interval.
        // Use the scale that was applied before that change.
        hourOffset: appliedHourHeight > 0 ? scroller.scrollTop / appliedHourHeight : 0,
      };
      container.style.removeProperty("--calendar-slot-height");
      delete container.dataset.timeZoom;
    };
  }, [root, view, interval, windowKey]);
}
