import { useQuery } from "@tanstack/react-query";
import { readJson } from "./source-data";
import { UNASSIGNED } from "./ship-calendars";

export interface Command {
  id: string;
  name: string;
  shortLabel: string;
  group: string;
  colorIndex: number;
  isOwnShip: boolean;
}
export interface CommandRoster {
  commands: Command[];
  source: string;
  version: string;
  provenance: string;
  assignmentEnabled: boolean;
}
export async function readCommands(signal?: AbortSignal): Promise<CommandRoster> {
  const payload = await readJson(await fetch("/api/v1/commands/list", {
    method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
    body: "{}", signal,
  }));
  if (!Array.isArray(payload.commands) || payload.commands.length > 32 ||
      !payload.commands.every((item) => item !== null && typeof item === "object" && !Array.isArray(item) &&
        [item.id, item.name, item.shortLabel, item.group].every((v) => typeof v === "string" && v.length > 0) &&
        typeof item.isOwnShip === "boolean" && typeof item.colorIndex === "number" &&
        Number.isInteger(item.colorIndex) && item.colorIndex >= 0 && item.colorIndex < 4) ||
      typeof payload.source !== "string" || typeof payload.version !== "string" ||
      typeof payload.provenance !== "string" || typeof payload.assignmentEnabled !== "boolean") {
    throw new Error("Ship roster response is invalid");
  }
  const roster = payload as unknown as CommandRoster;
  if (new Set(roster.commands.map((c) => c.id)).size !== roster.commands.length) {
    throw new Error("Ship roster has duplicate identifiers");
  }
  return roster;
}
export function useCommands() {
  return useQuery({
    queryKey: ["watchdesk-commands"], queryFn: ({ signal }) => readCommands(signal),
    staleTime: 30_000, gcTime: 60_000, retry: false,
  });
}

/** Only explicit canonical applicability. Never fall back to event.unit or sender. */
export function commandKeys(ids?: readonly string[]): string[] {
  return ids?.length ? [...new Set(ids)].map((id) => `unit:${id}`) : [UNASSIGNED];
}
const colors = ["#0b626b", "#245883", "#5a4383", "#85345f"];
export function commandColor(key: string, commands: Command[]) {
  if (key === UNASSIGNED) return "#805d18";
  const command = commands.find((c) => `unit:${c.id}` === key);
  if (command) return colors[command.colorIndex];
  let hash = 0;
  for (const char of key) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) | 0;
  return colors[(hash >>> 0) % colors.length];
}
export function commandName(key: string, commands: Command[]) {
  return key === UNASSIGNED ? "Unassigned / needs applicability review" :
    commands.find((c) => `unit:${c.id}` === key)?.name ?? key.slice(5);
}
export function CommandChips({ ids, commands }: { ids?: readonly string[]; commands: Command[] }) {
  return <span className="command-chips">{commandKeys(ids).map((key) => (
    <span className="command-chip" key={key} style={{ backgroundColor: commandColor(key, commands) }} title={commandName(key, commands)}>
      {key === UNASSIGNED ? "REVIEW" : commands.find((c) => `unit:${c.id}` === key)?.shortLabel ?? key.slice(5)}
    </span>
  ))}</span>;
}
