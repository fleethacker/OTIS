import { createContext, useContext } from "react";
import { sessionFetch } from "./session-access";

// Read-only projection of AuthGate's native session. It never refreshes tokens
// or assigns authorization; feature mutations are authorized by the server.
export interface AccountSession {
  authenticated: boolean;
  authMode: "local_demo" | "oidc";
  scope: string;
  user: { id: string; username: string; role: string } | null;
  permissions: string[];
  settings: { calendarRefreshSeconds: 0 | 30 | 60 | 300 };
}
export const SessionContext = createContext<{ session: AccountSession | null }>({ session: null });
export function useSession() {
  return useContext(SessionContext);
}
export interface NativeWorkflowIdentity {
  identity?: { username?: string; role?: string };
  userId?: string;
  scope: string;
  mode: string;
}
export function workflowSession(value: NativeWorkflowIdentity): AccountSession | null {
  if (
    typeof value.userId !== "string" ||
    value.userId === "" ||
    typeof value.identity?.username !== "string" ||
    !["viewer", "admin"].includes(value.identity.role ?? "") ||
    !["local_demo", "oidc"].includes(value.mode)
  ) {
    return null;
  }
  return {
    authenticated: true,
    authMode: value.mode as AccountSession["authMode"],
    scope: value.scope,
    user: {
      id: value.userId,
      username: value.identity.username,
      role: value.identity.role ?? "viewer",
    },
    permissions: ["schedule:read"],
    settings: { calendarRefreshSeconds: 30 },
  };
}
export function accountTime(value: string | null | undefined) {
  const date = new Date(value ?? "");
  return Number.isNaN(date.valueOf())
    ? "Unavailable"
    : `${date.toISOString().slice(0, 19).replace("T", " ")} UTC`;
}
export async function accountRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await sessionFetch(path, {
    ...init,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...init.headers },
  });
  const value: unknown = await response.json();
  if (!response.ok) {
    throw new Error(
      value !== null &&
        typeof value === "object" &&
        "message" in value &&
        typeof value.message === "string"
        ? value.message
        : "The request could not be completed. Please retry."
    );
  }
  return value as T;
}
