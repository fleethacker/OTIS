import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { TbX } from "react-icons/tb";

export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const previous = document.activeElement;
    const element = dialog.current;
    if (element && !element.open) {
      if (typeof element.showModal === "function") {
        element.showModal();
      } else {
        element.setAttribute("open", "");
      }
    }
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) {
        previous.focus();
      }
    };
  }, []);
  return createPortal(
    <dialog
      ref={dialog}
      className="app-modal"
      aria-labelledby={id}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header>
        <h2 id={id}>{title}</h2>
        <button
          type="button"
          className="btn btn-ghost btn-xs"
          aria-label={`Close ${title.toLowerCase()}`}
          onClick={onClose}
        >
          <TbX aria-hidden="true" />
        </button>
      </header>
      {children}
    </dialog>,
    document.body
  );
}
