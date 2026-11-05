import { useEffect, useState, type RefObject } from "react";

/** One brief, non-animated highlight after explicit catch-up navigation. */
export function useCalendarFocus(root: RefObject<HTMLDivElement | null>, target: string | undefined, ready: boolean) {
  const [highlighted, setHighlighted] = useState<string>();
  useEffect(() => {
    if (!target || !ready) { setHighlighted(undefined); return; }
    setHighlighted(target);
    const frame = requestAnimationFrame(() => {
      const controls = root.current?.querySelectorAll<HTMLElement>("[data-calendar-event]");
      const control = controls && [...controls].find((node) => node.dataset.calendarEvent === target);
      control?.scrollIntoView?.({ block: "center", inline: "nearest" });
    });
    const timer = window.setTimeout(() => setHighlighted(undefined), 6000);
    return () => { cancelAnimationFrame(frame); window.clearTimeout(timer); };
  }, [root, target, ready]);
  return highlighted;
}
