import { createContext, createElement, useContext, useState, type ReactNode } from "react";
import moment from "moment-timezone";
import type { Timestamp } from "@bufbuild/protobuf/wkt";
import { utc } from "./message-format";

export type TimeMode = "utc" | "local";
export const TIME_MODE_KEY = "watch-desk-display-time";
const DisplayTime = createContext<{ mode: TimeMode; setMode: (mode: TimeMode) => void }>({
  mode: "utc",
  setMode: () => {
    /* Default for isolated render checks. */
  },
});
export function DisplayTimeProvider({ children }: { children: ReactNode }) {
  const [mode, change] = useState<TimeMode>(() => {
    try {
      return localStorage.getItem(TIME_MODE_KEY) === "local" ? "local" : "utc";
    } catch {
      return "utc";
    }
  });
  return createElement(
    DisplayTime.Provider,
    {
      value: {
        mode,
        setMode: (next: TimeMode) => {
          change(next);
          try {
            localStorage.setItem(TIME_MODE_KEY, next);
          } catch {
            /* In-memory preference remains usable. */
          }
        },
      },
    },
    children
  );
}
export function deviceZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
export function zoneFor(mode: TimeMode) {
  return mode === "utc" ? "UTC" : deviceZone();
}
export function civilDate(date: Date, zone: string) {
  return moment.tz(date, zone).format("YYYY-MM-DD");
}
export function civilHour(date: string, hour: number, zone: string) {
  // Calendar addition, not a fixed elapsed day, owns the next midnight.
  const day = moment.tz(date, "YYYY-MM-DD", zone);
  return hour === 24 ? +day.add(1, "day") : +day.hour(hour);
}
export function displayTimestamp(value: Timestamp | undefined, mode: TimeMode, zone: string) {
  if (mode === "utc") {
    return utc(value);
  }
  return value
    ? moment
        .tz(Number(value.seconds) * 1000 + value.nanos / 1e6, zone)
        .format("YYYY-MM-DD HH:mm:ss [UTC]Z")
    : "Unavailable";
}
export function useDisplayTime() {
  const preference = useContext(DisplayTime);
  const zone = zoneFor(preference.mode);
  return {
    ...preference,
    zone,
    label: preference.mode === "utc" ? "Zulu / UTC" : `Local · ${zone}`,
    format: (value?: Timestamp) => displayTimestamp(value, preference.mode, zone),
  };
}
