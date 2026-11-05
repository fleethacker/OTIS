import { TbSettings } from "react-icons/tb";
import { Link } from "react-router-dom";
import { useIdentity } from "../hooks/useIdentity";

export function SettingsButton() {
  const { username, isLoading } = useIdentity();
  if (isLoading || !username) {
    return null;
  }

  return (
    <Link
      to="/account"
      className="btn app-button btn-ghost btn-sm header-settings-button"
      aria-label="Account & settings"
      title="Account & settings"
    >
      <TbSettings aria-hidden="true" />
    </Link>
  );
}
