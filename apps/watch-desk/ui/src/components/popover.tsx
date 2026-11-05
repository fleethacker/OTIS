import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { AppButton } from "./ui";

/** Small anchored popover with keyboard, focus and outside-click dismissal. */
export function Popover({
  label,
  trigger,
  children,
  align = "start",
}: {
  label: string;
  align?: "start" | "end";
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
      ?.querySelector<HTMLElement>(
        "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex='0']"
      )
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
        // Close only when focus moves to a known element outside. Safari and macOS
        // browsers do not focus links on click, so mousedown on a menu link blurs
        // with relatedTarget null; closing then would unmount the link before its
        // click lands. Outside clicks are handled by the pointerdown listener.
        const next = event.relatedTarget;
        if (next instanceof Node && !event.currentTarget.contains(next)) {
          setOpen(false);
        }
      }}
    >
      <AppButton
        ref={button}
        type="button"
        variant="ghost"
        className="popover-trigger"
        aria-label={label}
        title={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
      >
        {trigger}
      </AppButton>
      {open && (
        <div
          ref={panel}
          id={id}
          data-align={align}
          role="dialog"
          aria-label={label}
          className="popover-panel"
        >
          {children({ close })}
        </div>
      )}
    </div>
  );
}
