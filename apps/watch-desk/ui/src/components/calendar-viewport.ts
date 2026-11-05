import { useLayoutEffect, useRef, type RefObject } from "react";
import moment from "moment-timezone";
import { civilDate, civilHour } from "./display-time";
import type { CalendarView } from "./calendar-time";

/** Fit keeps seven days visible; Expanded retains Parker's lane-proportional width. */
export function calendarGridWidth(view: CalendarView, side: boolean, resources: number, lanes: number, expanded = false) {
  if (view === "week") return expanded ? 52 + 7 * Math.max(1, lanes) * 128 : 52 + 7 * 112;
  if (side) return 52 + resources * 168;
  return 52 + Math.max(1, lanes) * 128;
}

/** Scroll position only. Never change an event instant or infer a source time. */
export function openingScrollTime(from: number, to: number, starts: number[], now: number, view: CalendarView, zone: string) {
  const day = civilDate(new Date(from), zone);
  const clockOnAxis = (instant: number) => {
    const local = moment.tz(instant, zone);
    return civilHour(day, local.hour(), zone) + local.minute() * 60_000 + local.second() * 1000;
  };
  const candidates = starts.filter(Number.isFinite).map((value) => {
    const clipped = Math.max(from, Math.min(to - 1, value));
    return view === "week" ? clockOnAxis(clipped) : clipped;
  });
  if (now >= from && now < to) {
    // Clamp at the current civil day's midnight rather than wrapping to 2300 yesterday.
    const midnight = civilHour(civilDate(new Date(now), zone), 0, zone);
    const earlier = Math.max(midnight, now - 3_600_000);
    candidates.push(view === "week" ? clockOnAxis(earlier) : earlier);
  }
  return candidates.length ? Math.min(...candidates) : from;
}

/** Apply once after a successful source read; polling must not fight manual scrolling/zoom. */
export function useOpeningScroll(root: RefObject<HTMLDivElement | null>, key: string, ready: boolean, fraction: number) {
  const opened = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (opened.current === key || !root.current) return;
    const scroller = root.current.querySelector<HTMLElement>(".rbc-time-content");
    if (!scroller) return;
    const frame = ready ? requestAnimationFrame(() => {
      scroller.scrollTop = Math.max(0, Math.min(1, fraction)) * scroller.scrollHeight;
      opened.current = key;
    }) : null;
    const manual = () => { if (frame !== null) cancelAnimationFrame(frame); opened.current = key; };
    scroller.addEventListener("wheel", manual, { passive: true });
    scroller.addEventListener("pointerdown", manual);
    scroller.addEventListener("keydown", manual);
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      scroller.removeEventListener("wheel", manual);
      scroller.removeEventListener("pointerdown", manual);
      scroller.removeEventListener("keydown", manual);
    };
  }, [root, key, ready, fraction]);
}
