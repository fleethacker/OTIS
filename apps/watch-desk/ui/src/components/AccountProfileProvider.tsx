import { Fragment, useEffect, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  accountRequest,
  AccountRequestError,
  isAccountSession,
  isAccountSettings,
  SessionContext,
  type AccountSession,
  type AccountSettings,
} from "./session";
import { SettingsContext, useSettings } from "./settings-data";

const profileKey = ["account-profile"];

// Native AuthGate owns authentication and remounts App when its scope changes.
// This adapter loads only account preferences, station metadata and login briefing.
export function AccountProfileProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const settings = useSettings();
  const profile = useQuery({
    queryKey: profileKey,
    queryFn: async ({ signal }) => {
      const value = await accountRequest<unknown>("/api/v1/auth/session", {
        cache: "no-store",
        signal,
      });
      if (!isAccountSession(value) || !value.authenticated || !value.user) {
        throw new Error("Your account profile could not be verified. Please retry.");
      }
      return value;
    },
    retry: false,
  });
  useEffect(() => {
    // Same-account login in another window keeps the native identity scope.
    // Refresh metadata as well as the gate's authentication check; these reads
    // use sessionFetch and never renew an idle session.
    const focus = () => {
      if (document.visibilityState === "visible") {
        void client.invalidateQueries({ queryKey: profileKey });
        void client.invalidateQueries({ queryKey: ["settings", "preferences"] });
      }
    };
    window.addEventListener("focus", focus);
    return () => window.removeEventListener("focus", focus);
  }, [client]);
  async function refresh() {
    await client.invalidateQueries({ queryKey: profileKey });
  }
  async function saveSettings(value: AccountSettings) {
    const saved = await accountRequest<unknown>("/api/v1/account/settings", {
      method: "PATCH",
      body: JSON.stringify(value),
    });
    if (!isAccountSettings(saved)) {
      throw new Error("The saved settings could not be verified. Please retry.");
    }
    await client.cancelQueries({ queryKey: profileKey });
    client.setQueryData<AccountSession>(profileKey, (current) =>
      current ? { ...current, settings: saved } : current
    );
    client.setQueryData(["settings", "preferences"], { timezone: saved.timezone });
  }
  async function logout() {
    const response = await fetch("/auth/logout", { method: "POST", credentials: "same-origin" });
    if (!response.ok) {
      throw new Error("Sign-out failed. Please retry.");
    }
    window.location.replace("/calendar");
  }
  if (profile.isError) {
    return (
      <main className="session-gate">
        <p role="alert">{profile.error.message}</p>
        <button className="btn" onClick={() => void refresh()}>
          Retry account profile
        </button>
        {profile.error instanceof AccountRequestError &&
          [401, 403].includes(profile.error.status) && (
            <a
              className="btn"
              href={`/auth/login?return=${encodeURIComponent(window.location.pathname + window.location.search)}`}
            >
              Sign in again
            </a>
          )}
      </main>
    );
  }
  if (!profile.data) {
    return <p role="status">Loading your account…</p>;
  }
  const timezone = settings.shared ? settings.timezone : profile.data.settings.timezone;
  const session = {
    ...profile.data,
    settings: { ...profile.data.settings, timezone },
  };
  const scope = JSON.stringify([
    session.user?.id,
    session.user?.role,
    session.user?.stationAssignment,
    session.stationAssignmentRequired,
    session.login?.startedAt,
  ]);
  return (
    <SettingsContext.Provider value={{ ...settings, timezone }}>
      <SessionContext.Provider value={{ session, refresh, saveSettings, logout }}>
        <Fragment key={scope}>{children}</Fragment>
      </SessionContext.Provider>
    </SettingsContext.Provider>
  );
}
