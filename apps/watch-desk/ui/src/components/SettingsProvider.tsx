import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { SettingsContext, settingsRequest, type SettingsReply } from "./settings-data";
export function SettingsProvider({ children }: { children: ReactNode }) {
  const shared = useQuery({
    queryKey: ["settings", "shared"],
    queryFn: () => settingsRequest<SettingsReply>("get"),
    retry: false,
  });
  const preferences = useQuery({
    queryKey: ["settings", "preferences"],
    queryFn: () => settingsRequest<{ timezone: string }>("preferences"),
    retry: false,
  });
  if (shared.isError || preferences.isError) {
    return (
      <div className="alert" role="alert">
        Settings unavailable.{" "}
        <button
          className="btn btn-sm"
          onClick={() => {
            void shared.refetch();
            void preferences.refetch();
          }}
        >
          Retry
        </button>
      </div>
    );
  }
  if (shared.isPending || preferences.isPending) {
    return <p role="status">Loading…</p>;
  }
  return (
    <SettingsContext.Provider
      value={{
        shared: shared.data,
        timezone: preferences.data.timezone || shared.data.settings.defaultTimezone,
      }}
    >
      {children}
    </SettingsContext.Provider>
  );
}
