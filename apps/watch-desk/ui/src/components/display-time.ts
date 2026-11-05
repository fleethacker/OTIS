import { createContext, createElement, useContext, type ReactNode } from "react";
import { useSettings } from "./settings-data";
import moment from "moment-timezone";
import type { Timestamp } from "@bufbuild/protobuf/wkt";
import { utc } from "./message-format";

export type TimeMode = "utc" | "local";
export const TIME_MODE_KEY = "watch-desk-display-time";
const DisplayTime = createContext<string>("utc");
export function DisplayTimeProvider({ children }: { children: ReactNode }) {
  const { timezone } = useSettings();
  return createElement(
    DisplayTime.Provider,
    { value: timezone === "UTC" ? "utc" : timezone },
    children
  );
}
export function deviceZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
export function zoneFor(mode: string) {
  return mode === "utc" ? "UTC" : mode === "local" ? deviceZone() : mode;
}
export function civilDate(date: Date, zone: string) {
  return moment.tz(date, zone).format("YYYY-MM-DD");
}
export function civilHour(date: string, hour: number, zone: string) {
  // Calendar addition, not a fixed elapsed day, owns the next midnight.
  const day = moment.tz(date, "YYYY-MM-DD", zone);
  return hour === 24 ? +day.add(1, "day") : +day.hour(hour);
}
export function displayTimestamp(value: Timestamp | undefined, mode: string, zone: string) {
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
  const mode = useContext(DisplayTime);
  const zone = zoneFor(mode);
  return {
    mode,
    zone,
    label: mode === "utc" ? "Zulu / UTC" : zone,
    format: (value?: Timestamp) => displayTimestamp(value, mode, zone),
  };
}
