import type { RouteMeta } from "../route-registry";
import { useIdentity } from "../hooks/useIdentity";
import { SettingsContent } from "../components/settings-content";

export const route: RouteMeta = { path: "/settings", label: "Settings", order: 20 };

export default function Settings() {
  const { role } = useIdentity();
  return (
    <div className="settings-page">
      <h1>{role === "admin" ? "Settings" : "Preferences"}</h1>
      <SettingsContent />
    </div>
  );
}
