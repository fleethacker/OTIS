import type { MessageRecord } from "../gen/app/v1/models_pb";

export const UNASSIGNED = "unassigned:";
// Replace this boundary with verified upstream IDs if a ship registry is introduced.
// Trim edges only: case, aliases and internal spelling are not verified identities.
export function shipKey(unit?: string) {
  return unit !== undefined && unit.trim() !== "" ? `unit:${unit.trim()}` : UNASSIGNED;
}
export function shipName(unit?: string) {
  return unit !== undefined && unit.trim() !== "" ? unit.trim() : "Unassigned / ship unavailable";
}
export function shipColor(key: string) {
  let hash = 0;
  for (const char of key) {
    hash = (Math.imul(hash, 31) + char.charCodeAt(0)) | 0;
  }
  return ["#12606b", "#55428b", "#854329", "#28613b", "#853d64", "#365b88"][(hash >>> 0) % 6];
}
export function shipOptions(messages: MessageRecord[]) {
  const options = new Map<string, string>();
  for (const message of messages) {
    for (const event of message.events) {
      options.set(shipKey(event.unit), shipName(event.unit));
    }
    if (message.events.length === 0 && message.processingStatus === "needs_review") {
      options.set(UNASSIGNED, shipName());
    }
  }
  return [...options].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}
/** Explicit "all ships" URL state, distinct from no selection (which uses shared defaults). */
export const ALL_SHIPS = "all";
export function readShips(value: string | null): Set<string> | undefined {
  if (value === null || value === ALL_SHIPS) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed) && parsed.every((key) => typeof key === "string")) {
      return new Set(parsed);
    }
  } catch {
    /* Invalid explicit state must never broaden selection. */
  }
  return new Set(["invalid-selection:"]);
}

/** Ships in view: an explicit URL selection, else shared default ships, else the
 * calendar commands from Settings, else all ships. */
export function effectiveShips(
  value: string | null,
  settings?: { defaultShips: string[]; commandIds: string[] }
): Set<string> | undefined {
  if (value !== null) return readShips(value);
  if (settings?.defaultShips.length) return new Set(settings.defaultShips);
  if (settings?.commandIds.length) return new Set(settings.commandIds.map((id) => `unit:${id}`));
  return undefined;
}
/** Shared by timeline and custody reads; explicit empty/invalid URLs never broaden. */
export function selectedShipFilters(ships?: Set<string>) {
  return ships ? {
    commandIds: [...ships].filter((v) => v.startsWith("unit:")).map((v) => v.slice(5)),
    unassignedOnly: ships.has(UNASSIGNED),
    noCommands: ships.size === 0 || [...ships].some((v) => !v.startsWith("unit:") && v !== UNASSIGNED),
  } : {};
}
/** True only when the selection leaves out a roster ship (or the roster is unavailable to prove otherwise). */
export function shipsExclude(ships: Set<string> | undefined, commandIds: string[] | undefined): boolean {
  if (ships === undefined) return false;
  if (commandIds === undefined) return true;
  return ![...commandIds.map((id) => `unit:${id}`), UNASSIGNED].every((key) => ships.has(key));
}
