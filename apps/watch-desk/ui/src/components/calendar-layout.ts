import { useLayoutEffect, useRef, useState, type RefObject } from "react";

export interface VisualInterval<T> {
  event: T;
  top: number;
  height: number;
}

// Partition connected collisions into lanes, including the visible footprint of
// point/short-event labels. The source event and its timestamps are never edited.
export function calendarLanes<T>(input: VisualInterval<T>[]) {
  const sorted = [...input].sort((a, b) => (a.top === b.top ? b.height - a.height : a.top - b.top));
  const output: (VisualInterval<T> & { lane: number; columns: number })[] = [];
  let cluster: typeof output = [];
  let ends: number[] = [];
  let bottom = -Infinity;
  function finish() {
    for (const item of cluster) {
      item.columns = ends.length;
      output.push(item);
    }
    cluster = [];
    ends = [];
  }
  for (const item of sorted) {
    if (item.top >= bottom) {
      finish();
      bottom = -Infinity;
    }
    let lane = ends.findIndex((end) => end <= item.top);
    if (lane < 0) {
      lane = ends.length;
    }
    ends[lane] = item.top + item.height;
    bottom = Math.max(bottom, item.top + item.height);
    cluster.push({ ...item, lane, columns: 1 });
  }
  finish();
  return output;
}

export function useCalendarMeasurements(root: RefObject<HTMLDivElement | null>) {
  const [metrics, setMetrics] = useState({ height: 1056, titles: new Map<string, number>() });
  const observer = useRef<ResizeObserver | null>(null);
  // A layout pass also covers new source cards after an asynchronous read. The
  // observer handles wheel zoom, resizing and loaded-font title wrapping.
  useLayoutEffect(() => {
    const container = root.current;
    if (!container) {
      return;
    }
    function measure() {
      if (!container) {
        return;
      }
      const gutter = container.querySelector<HTMLElement>(".rbc-time-gutter");
      const height = gutter?.getBoundingClientRect().height;
      if (height === undefined || height <= 0) {
        return;
      }
      const titles = new Map<string, number>();
      container.querySelectorAll<HTMLElement>("[data-calendar-event]").forEach((card) => {
        const title = card.querySelector<HTMLElement>(".calendar-event-title");
        const key = card.dataset.calendarEvent;
        if (key !== undefined && title !== null) {
          titles.set(key, Math.max(28, Math.ceil(title.getBoundingClientRect().height) + 8));
        }
      });
      setMetrics((previous) =>
        previous.height === height &&
        previous.titles.size === titles.size &&
        [...titles].every(([key, value]) => previous.titles.get(key) === value)
          ? previous
          : { height, titles }
      );
    }
    measure();
    observer.current = new ResizeObserver(measure);
    observer.current.observe(container);
    const gutter = container.querySelector(".rbc-time-gutter");
    if (gutter) {
      observer.current.observe(gutter);
    }
    container
      .querySelectorAll(".calendar-event-title")
      .forEach((title) => observer.current?.observe(title));
    return () => observer.current?.disconnect();
  });
  return metrics;
}
