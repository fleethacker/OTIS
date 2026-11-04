import { useEffect, useId, useRef, useState, type ReactNode } from "react";

/** Small anchored popover with keyboard, focus and outside-click dismissal. */
export function Popover({
  label,
  trigger,
  children,
}: {
  label: string;
  trigger: ReactNode;
  children: (actions: { close: () => void }) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  function close() {
    setOpen(false);
    button.current?.focus();
  }
  useEffect(() => {
    if (!open) {
      return;
    }
    panel.current
      ?.querySelector<HTMLElement>("a[href], button:not([disabled]), [tabindex='0']")
      ?.focus();
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        root.current !== null &&
        !root.current.contains(event.target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  return (
    <div
      ref={root}
      className="popover"
      onKeyDown={(event) => {
        if (open && event.key === "Escape") {
          event.stopPropagation();
          event.preventDefault();
          close();
        }
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setOpen(false);
        }
      }}
    >
      <button
        ref={button}
        type="button"
        className="btn btn-ghost popover-trigger"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
      >
        {trigger}
      </button>
      {open && (
        <div ref={panel} id={id} role="dialog" aria-label={label} className="popover-panel">
          {children({ close })}
        </div>
      )}
    </div>
  );
}
