import { createContext, useContext } from "react";
import { isoBoundary } from "./watch-boundary";

/** Additive /auth/session fields. The server, never this UI, owns lastSeenAt. */
export interface WatchSession {
  scope: string;
  since?: string;
  basis?: "last_seen" | "turnover" | "default_24h";
}
export const WatchSessionContext = createContext<WatchSession | undefined>(undefined);
export function useWatchSession() { return useContext(WatchSessionContext); }
export function pinnedWatch(session?: WatchSession) {
  if (typeof session?.since !== "string" || !["last_seen", "turnover", "default_24h"].includes(session.basis ?? "")) return undefined;
  const at = isoBoundary(session.since);
  return at === undefined ? undefined : { at, basis: session.basis! };
}
