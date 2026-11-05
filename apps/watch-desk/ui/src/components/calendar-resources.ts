import { commandKeys, commandName, type Command } from "./command-roster";
import { UNASSIGNED } from "./ship-calendars";

export interface ShipResource { id: string; title: string; name: string }
interface Assigned { commandIds?: string[]; placementIds?: string[] }
function calendarKeys(row: Assigned) { return commandKeys(row.placementIds ?? row.commandIds); }

export function shipResources(commands: Command[], rows: readonly Assigned[], selected?: Set<string>): ShipResource[] {
  const ordered = [...commands].sort((a, b) => Number(b.isOwnShip) - Number(a.isOwnShip));
  const all = [...ordered.map((command) => `unit:${command.id}`), ...rows.flatMap(calendarKeys), UNASSIGNED];
  const keys = [...new Set([...all, ...(selected ?? [])])].filter((key) => selected === undefined || selected.has(key));
  return keys.filter((key) => key === UNASSIGNED || (key.startsWith("unit:") && key.length > 5)).map((key) => ({
    id: key,
    title: key === UNASSIGNED ? "REVIEW" : commands.find((c) => `unit:${c.id}` === key)?.shortLabel ?? key.slice(5),
    name: commandName(key, commands),
  }));
}

/** Presentation copies only: canonical IDs, timestamps and combined counts stay unchanged. */
export function inShipColumns<T extends Assigned>(rows: readonly T[], resources: ShipResource[]): (T & { resourceId: string })[] {
  const visible = new Set(resources.map((resource) => resource.id));
  return rows.flatMap((row) => calendarKeys(row)
    .filter((id) => visible.has(id))
    .map((resourceId) => ({ ...row, resourceId })));
}
