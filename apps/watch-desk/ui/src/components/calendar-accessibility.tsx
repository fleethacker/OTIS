import { useLayoutEffect, useRef, type ReactNode } from "react";

// RBC 1.20's overlapping visual layers are not a semantic table: event spans
// sit outside date cells and empty all-day rows have no cells. Expose this
// read-only schedule as ordinary content within the named scroll region instead.
// Never remove control roles, focusability, labels or event/date handlers.
export function CalendarAccessibility({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const container = root.current;
    if (!container) {
      return;
    }
    const normalize = () => {
      for (const element of container.querySelectorAll(
        '[role="table"], [role="rowgroup"], [role="row"], [role="cell"], [role="columnheader"]'
      )) {
        if (element.getAttribute("role") === "table") {
          element.setAttribute("role", "group");
        } else {
          element.removeAttribute("role");
        }
      }
    };
    normalize();
    // RBC remeasures rows after mount/resize, and popups add new descendants.
    // Idempotence prevents attribute observation from creating an update loop.
    const observer = new MutationObserver(normalize);
    observer.observe(container, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["role"],
    });
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={root} style={{ display: "contents" }}>
      {children}
    </div>
  );
}
