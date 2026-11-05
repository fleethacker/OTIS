import { createContext, useContext } from "react";
import { readJson } from "./source-data";
import { sessionFetch } from "./session-access";
export interface CommandSettings {
  version: number;
  shipName: string;
  unitName: string;
  commandIds: string[];
  outgoingCommand: string;
  actionAuthority: string;
  defaultTimezone: string;
  ai: { endpoint: string; model: string; secretRef: string } | null;
}
export interface SettingsReply {
  settings: CommandSettings;
  revision: string;
}
export async function settingsRequest<T>(operation: string, body: object = {}): Promise<T> {
  const response = await sessionFetch(`/api/v1/settings/${operation}`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await readJson(response)) as unknown as T;
}
export const SettingsContext = createContext<{ shared?: SettingsReply; timezone: string }>({
  timezone: "UTC",
});
export function useSettings() {
  return useContext(SettingsContext);
}
