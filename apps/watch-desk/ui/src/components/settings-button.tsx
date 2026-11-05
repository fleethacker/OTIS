import { useState } from "react";
import { TbSettings } from "react-icons/tb";
import { useIdentity } from "../hooks/useIdentity";
import { Modal } from "./modal";
import { SettingsContent } from "./settings-content";

export function SettingsButton() {
  const { role, isLoading } = useIdentity();
  const [open, setOpen] = useState(false);
  const [visited, setVisited] = useState(false);
  if (isLoading || role !== "admin") {
    return null;
  }

  return (
    <>
      <button
        type="button"
        className="btn btn-ghost header-settings-button"
        aria-label="Settings"
        title="Settings"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setVisited(true);
          setOpen(true);
        }}
      >
        <TbSettings aria-hidden="true" />
      </button>
      {visited && (
        <Modal
          title="Settings"
          className="settings-modal"
          open={open}
          onClose={() => setOpen(false)}
        >
          <SettingsContent active={open} />
        </Modal>
      )}
    </>
  );
}
