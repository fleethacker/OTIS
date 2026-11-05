import { createContext, useContext } from "react";
import moment from "moment-timezone";
import { sessionFetch } from "./session-access";

export type UserRole = "viewer" | "admin";
export interface AccountUser {
  id: string;
  username: string;
  displayName: string;
  email: string;
  role: UserRole;
  active: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  previousLoginAt: string | null;
  stationAssignment?: StationAssignment | null;
}
export interface StationAssignment {
  shipName: string;
  commandIds: string[];
  department: string;
  watchStation: string;
  responsibilityIds: string[];
  includeUnassigned: boolean;
  revision: number;
  source: "admin" | "oidc";
}
export interface AccountSettings {
  timezone: string;
  calendarRefreshSeconds: 0 | 30 | 60 | 300;
  defaultCalendarView: "day" | "week" | "month";
  messageScope?: MessageScope;
}
export interface MessageScope {
  allCommands: boolean;
  commandIds: string[];
  includeUnassigned: boolean;
  responsibilityIds?: string[];
}
export const defaultMessageScope: MessageScope = {
  allCommands: true,
  commandIds: [],
  includeUnassigned: true,
};
export interface AccountSession {
  authenticated: boolean;
  authMode: "local_demo" | "oidc";
  loginUrl: string;
  user: AccountUser | null;
  permissions: string[];
  settings: AccountSettings;
  login?: LoginSnapshot | null;
  stationAssignmentRequired?: boolean;
  openBriefing?: boolean;
}
export interface LoginSnapshot {
  startedAt: string;
  previousLoginAt: string | null;
  briefingAvailable: boolean;
}
export const defaultSettings: AccountSettings = {
  timezone: "UTC",
  calendarRefreshSeconds: 30,
  defaultCalendarView: "day",
};
interface SessionState {
  session: AccountSession | null;
  refresh: () => Promise<void>;
  saveSettings: (settings: AccountSettings) => Promise<void>;
  logout: () => Promise<void>;
}
export const SessionContext = createContext<SessionState>({
  session: null,
  refresh: () => Promise.resolve(),
  saveSettings: () => Promise.reject(new Error("Sign in to save settings.")),
  logout: () => Promise.resolve(),
});
export function useSession() {
  return useContext(SessionContext);
}
export function useAccountSettings() {
  return useSession().session?.settings ?? defaultSettings;
}
export function usePermission(permission: string) {
  return useSession().session?.permissions.includes(permission) === true;
}
export function accountName(user: AccountUser) {
  return user.displayName.trim() || user.username.trim() || user.id;
}
export function roleLabel(role: UserRole) {
  return role === "admin" ? "Administrator" : "Viewer";
}
export function accountTime(value: string | null | undefined) {
  if (value === null || value === undefined || value === "") {
    return "No previous sign-in";
  }
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? "Unavailable"
    : `${date.toISOString().slice(0, 19).replace("T", " ")} UTC`;
}
export class AccountRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = "AccountRequestError";
  }
}
export async function accountRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await sessionFetch(path, {
    ...init,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...init.headers },
  });
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new Error("The server returned an unexpected response. Please retry.");
  }
  if (!response.ok) {
    throw new AccountRequestError(
      data !== null &&
        typeof data === "object" &&
        "message" in data &&
        typeof data.message === "string"
        ? data.message
        : "The request could not be completed. Please retry.",
      response.status
    );
  }
  return data as T;
}

export function isAccountSettings(value: unknown): value is AccountSettings {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const settings = value as Record<string, unknown>;
  return (
    typeof settings.timezone === "string" &&
    moment.tz.zone(settings.timezone) !== null &&
    typeof settings.calendarRefreshSeconds === "number" &&
    [0, 30, 60, 300].includes(settings.calendarRefreshSeconds) &&
    typeof settings.defaultCalendarView === "string" &&
    ["day", "week", "month"].includes(settings.defaultCalendarView) &&
    (settings.messageScope === undefined || isMessageScope(settings.messageScope))
  );
}
export function isMessageScope(value: unknown): value is MessageScope {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const scope = value as Record<string, unknown>;
  return (
    typeof scope.allCommands === "boolean" &&
    typeof scope.includeUnassigned === "boolean" &&
    Array.isArray(scope.commandIds) &&
    scope.commandIds.every((id) => typeof id === "string" && id.trim() !== "") &&
    (scope.responsibilityIds === undefined ||
      (Array.isArray(scope.responsibilityIds) &&
        scope.responsibilityIds.every((id) => typeof id === "string" && id.trim() !== "")))
  );
}
export function isAccountSession(value: unknown): value is AccountSession {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  const user = candidate.user;
  return (
    typeof candidate.authenticated === "boolean" &&
    (candidate.authMode === "local_demo" || candidate.authMode === "oidc") &&
    typeof candidate.loginUrl === "string" &&
    Array.isArray(candidate.permissions) &&
    candidate.permissions.every((permission) => typeof permission === "string") &&
    isAccountSettings(candidate.settings) &&
    (candidate.openBriefing === undefined || typeof candidate.openBriefing === "boolean") &&
    (candidate.stationAssignmentRequired === undefined ||
      typeof candidate.stationAssignmentRequired === "boolean") &&
    (candidate.login === undefined ||
      candidate.login === null ||
      isLoginSnapshot(candidate.login)) &&
    (!candidate.authenticated ||
      (user !== null &&
        typeof user === "object" &&
        "id" in user &&
        typeof user.id === "string" &&
        user.id !== "" &&
        "role" in user &&
        (user.role === "admin" || user.role === "viewer") &&
        "active" in user &&
        user.active === true &&
        (!("stationAssignment" in user) ||
          user.stationAssignment === null ||
          isStationAssignment(user.stationAssignment))))
  );
}
export function isStationAssignment(value: unknown): value is StationAssignment {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const station = value as Record<string, unknown>;
  return (
    [station.shipName, station.department, station.watchStation].every(
      (name) => typeof name === "string" && name.trim() !== ""
    ) &&
    [station.commandIds, station.responsibilityIds].every(
      (ids) =>
        Array.isArray(ids) &&
        ids.length > 0 &&
        ids.every((id) => typeof id === "string" && id.trim() !== "")
    ) &&
    typeof station.includeUnassigned === "boolean" &&
    typeof station.revision === "number" &&
    Number.isSafeInteger(station.revision) &&
    station.revision > 0 &&
    (station.source === "admin" || station.source === "oidc")
  );
}
export function isTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}
function isLoginSnapshot(value: unknown): value is LoginSnapshot {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const login = value as Record<string, unknown>;
  return (
    isTimestamp(login.startedAt) &&
    (login.previousLoginAt === null || isTimestamp(login.previousLoginAt)) &&
    typeof login.briefingAvailable === "boolean"
  );
}
