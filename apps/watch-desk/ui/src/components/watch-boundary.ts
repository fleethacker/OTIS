import { useEffect, useState } from "react";
const months = "JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC".split(" ");
function utc(year: number, month: number, day: number, hour: number, minute: number, second = 0, ms = 0): number | undefined {
  if (year < 1 || year > 9999 || month < 0 || month > 11) return undefined;
  const date = new Date(0);
  date.setUTCFullYear(year, month, day); date.setUTCHours(hour, minute, second, ms);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month && date.getUTCDate() === day &&
    date.getUTCHours() === hour && date.getUTCMinutes() === minute && date.getUTCSeconds() === second && date.getUTCMilliseconds() === ms ? +date : undefined;
}
export function isoBoundary(value: string): number | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/.exec(value);
  return m ? utc(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], Number((m[7] ?? "").padEnd(3, "0"))) : undefined;
}
export function parseSinceUTC(value: string): number | undefined {
  const m = /^(\d{1,2}) ([A-Z]{3}) (\d{4}) (\d{2})(\d{2})(?:(\d{2})(?:\.(\d{1,3}))?)?Z$/.exec(value.trim().toUpperCase().replace(/\s+/g, " "));
  return m ? utc(+m[3], months.indexOf(m[2]), +m[1], +m[4], +m[5], Number(m[6] ?? 0), Number((m[7] ?? "").padEnd(3, "0"))) : undefined;
}
export function formatSinceUTC(value: number): string {
  if (!Number.isFinite(value)) return "Time unavailable";
  const d = new Date(value), pad = (v: number) => String(v).padStart(2, "0");
  const seconds = d.getUTCSeconds() || d.getUTCMilliseconds() ? pad(d.getUTCSeconds()) : "";
  const fraction = d.getUTCMilliseconds() ? `.${String(d.getUTCMilliseconds()).padStart(3, "0")}` : "";
  return `${pad(d.getUTCDate())} ${months[d.getUTCMonth()]} ${String(d.getUTCFullYear()).padStart(4, "0")} ${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${seconds}${fraction}Z`;
}
export function latestTurnover(now: number, times?: string[]): number | undefined {
  if (!times?.length || times.some((v) => !/^(?:[01]\d|2[0-3])[0-5]\dZ$/.test(v))) return undefined;
  const day = new Date(now); day.setUTCHours(0, 0, 0, 0);
  const values = times.map((v) => +day + (Number(v.slice(0, 2)) * 60 + Number(v.slice(2, 4))) * 60_000).sort((a, b) => a - b);
  const earlier = values.filter((v) => v <= now);
  return earlier[earlier.length - 1] ?? values[values.length - 1] - 86400000;
}
export function sinceState(raw: string | null, now: number, times?: string[]) {
  const closed = raw?.startsWith("closed:") === true;
  const choice = raw === null ? "auto" : closed ? raw.slice(7) : raw;
  const boundary = choice === "auto" ? latestTurnover(now, times) : isoBoundary(choice);
  return { open: raw !== null && !closed, choice, boundary, invalid: choice !== "auto" && boundary === undefined };
}
export function useWatchClock(enabled = true) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const update = () => setNow(Date.now());
    const timer = window.setInterval(update, 30_000);
    window.addEventListener("focus", update);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", update); };
  }, [enabled]);
  return now;
}
