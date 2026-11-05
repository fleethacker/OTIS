import { useContext, useId, useLayoutEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { TbX } from "react-icons/tb";
import { SessionVisibility } from "./session-visibility";
import { AppButton } from "./ui";

export function Modal({
  title,
  onClose,
  children,
  open = true,
  className = "",
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  open?: boolean;
  className?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  const sessionVisible = useContext(SessionVisibility);
  const visible = open && sessionVisible;
  useLayoutEffect(() => {
    if (!visible) {
      return;
    }
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
      if (element?.open === true) {
        if (typeof element.close === "function") {
          element.close();
        } else {
          element.removeAttribute("open");
        }
      }
      if (previous instanceof HTMLElement && previous.isConnected) {
        previous.focus();
      }
    };
  }, [visible]);
  return createPortal(
    <dialog
      ref={dialog}
      hidden={!visible}
      className={`app-modal ${className}`}
      aria-labelledby={id}
      aria-modal="true"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header>
        <h2 id={id}>{title}</h2>
        <AppButton
          type="button"
          variant="ghost"
          size="xs"
          aria-label={`Close ${title.toLowerCase()}`}
          onClick={onClose}
        >
          <TbX aria-hidden="true" />
        </AppButton>
      </header>
      {children}
    </dialog>,
    document.body
  );
}
