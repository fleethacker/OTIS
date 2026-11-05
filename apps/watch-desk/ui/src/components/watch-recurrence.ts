/** Times and cadence of a standalone recurrence, read only from its RRULE. */
const MAX_TIMES = 12;
function parts(rule: string | undefined) {
  const map = new Map<string, string>();
  for (const part of (rule ?? "").split(";")) {
    const [name, value] = part.split("=");
    if (name && value !== undefined) map.set(name.trim().toUpperCase(), value.trim());
  }
  return map;
}
function numbers(value: string | undefined, max: number): number[] | undefined {
  if (value === undefined || value === "") return undefined;
  const list = value.split(",").map((v) => (/^\d{1,2}$/.test(v.trim()) ? Number(v) : NaN));
  return list.every((v) => Number.isInteger(v) && v >= 0 && v <= max) ? list : undefined;
}
/** "daily" for an every-day rule, otherwise "recurring". */
export function recurrenceCadence(rule: string | undefined): "daily" | "recurring" {
  const rules = parts(rule);
  const interval = rules.get("INTERVAL");
  return rules.get("FREQ") === "DAILY" && !rules.has("BYDAY") && (interval === undefined || interval === "1") ? "daily" : "recurring";
}
/**
 * UTC times of day such as "0800Z" from BYHOUR and BYMINUTE of a daily or weekly rule,
 * ascending. Empty when the rule lacks them (or has more than fit): no time is inferred.
 */
export function recurrenceTimes(rule: string | undefined): string[] {
  const rules = parts(rule);
  const hours = numbers(rules.get("BYHOUR"), 23);
  const minutes = numbers(rules.get("BYMINUTE"), 59);
  if (!hours || !minutes || !["DAILY", "WEEKLY"].includes(rules.get("FREQ") ?? "")) return [];
  const pad = (v: number) => String(v).padStart(2, "0");
  const times = [...new Set(hours.flatMap((h) => minutes.map((m) => `${pad(h)}${pad(m)}Z`)))].sort();
  return times.length > MAX_TIMES ? [] : times;
}
