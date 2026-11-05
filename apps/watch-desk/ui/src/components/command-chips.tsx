import { UNASSIGNED } from "./ship-calendars";
import { commandColor, commandKeys, commandName, type Command } from "./command-roster";

export function CommandChips({ ids, commands }: { ids?: readonly string[]; commands: Command[] }) {
  return (
    <span className="command-chips">
      {commandKeys(ids).map((key) => (
        <span
          className="command-chip"
          key={key}
          style={{ backgroundColor: commandColor(key, commands) }}
          title={commandName(key, commands)}
        >
          {key === UNASSIGNED
            ? "REVIEW"
            : (commands.find((c) => `unit:${c.id}` === key)?.shortLabel ?? key.slice(5))}
        </span>
      ))}
    </span>
  );
}
