import type { ReactNode } from "react";
import type { DeskNetwork } from "./xnet-data";
import { useQuery } from "@tanstack/react-query";
import { SettingsContext, settingsRequest, type SettingsReply } from "./settings-data";
import { AppButton, Notice } from "./ui";
export function SettingsProvider({ children }: { children: ReactNode }) {
  const shared = useQuery({
    queryKey: ["settings", "shared"],
    queryFn: () => settingsRequest<SettingsReply>("get"),
    retry: false,
  });
  const preferences = useQuery({
    queryKey: ["settings", "preferences"],
    queryFn: () => settingsRequest<{ timezone: string; deskNetwork?: DeskNetwork }>("preferences"),
    retry: false,
  });
  if (shared.isError || preferences.isError) {
    return (
      <Notice tone="error" role="alert">
        Settings unavailable.{" "}
        <AppButton
          size="sm"
          onClick={() => {
            void shared.refetch();
            void preferences.refetch();
          }}
        >
          Retry
        </AppButton>
      </Notice>
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
        deskNetwork: preferences.data.deskNetwork ?? "ALL",
      }}
    >
      {children}
    </SettingsContext.Provider>
  );
}
