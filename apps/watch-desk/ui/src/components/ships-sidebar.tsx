import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { UNASSIGNED } from "./ship-calendars";
import { commandColor, commandName, type CommandRoster } from "./command-roster";

export function ShipsSidebar({ roster, selected, pending, error, retry, onChange }: {
  roster?: CommandRoster;
  selected?: Set<string>;
  pending: boolean;
  error?: string;
  retry: () => void;
  onChange: (selection: Set<string> | undefined) => void;
}) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(() => !window.matchMedia("(max-width: 900px)").matches);
  const location = useLocation();
  const commands = roster?.commands ?? [];
  const keys = [...commands.map((c) => `unit:${c.id}`), UNASSIGNED];
  const active = selected ?? new Set(keys);
  const groups = new Map<string, string[]>();
  for (const command of [...commands].sort((a, b) => Number(b.isOwnShip) - Number(a.isOwnShip) || a.group.localeCompare(b.group) || a.name.localeCompare(b.name))) {
    const group = command.isOwnShip ? "Own ship" : command.group;
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group)!.push(`unit:${command.id}`);
  }
  groups.set("Review", [UNASSIGNED]);
  function toggle(values: string[], checked: boolean) {
    const next = new Set(active);
    for (const key of values) checked ? next.add(key) : next.delete(key);
    onChange(next);
  }
  return (
    <aside className="ships-sidebar" aria-label="Ship calendars">
      <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
        <summary>Ships <small>({keys.filter((key) => active.has(key)).length} of {keys.length})</small></summary>
        {pending && <p aria-live="polite">Loading ship roster…</p>}
        {error && <p role="alert">Ship roster unavailable. <button className="btn btn-sm" onClick={retry}>Retry roster</button></p>}
        {roster && !error && <>
          <p className="roster-provenance">Fictional demo roster · view filter, not authorization.</p>
          {commands.length > 6 && <label>Find ship<input className="input input-sm" type="search" value={search} onChange={(e) => setSearch(e.target.value)} /></label>}
          <div className="ship-actions">
            <button className="btn btn-xs" onClick={() => onChange(undefined)}>Select all</button>
            <button className="btn btn-xs" onClick={() => onChange(new Set())}>Clear all</button>
            {roster.defaultShips && <button className="btn btn-xs" onClick={() => onChange(new Set(roster.defaultShips))}>Use app defaults</button>}
          </div>
          {[...groups].map(([group, values]) => {
            const visible = values.filter((key) => commandName(key, commands).toLowerCase().includes(search.toLowerCase()));
            if (!visible.length) return null;
            return <fieldset key={group}>
              <legend><label><input type="checkbox"
                checked={visible.every((key) => active.has(key))}
                ref={(node) => { if (node) node.indeterminate = visible.some((key) => active.has(key)) && !visible.every((key) => active.has(key)); }}
                onChange={(e) => toggle(visible, e.target.checked)} />{group}</label></legend>
              {visible.map((key) => <div className="ship-choice" key={key}>
                <label><input type="checkbox" checked={active.has(key)} onChange={(e) => toggle([key], e.target.checked)} />
                  <span className="ship-swatch" style={{ backgroundColor: commandColor(key, commands) }} aria-hidden="true" />
                  {commandName(key, commands)}
                </label>
                <button className="btn btn-ghost btn-xs" aria-label={`Only ${commandName(key, commands)}`} onClick={() => onChange(new Set([key]))}>Only</button>
              </div>)}
            </fieldset>;
          })}
          {selected && [...selected].some((key) => !keys.includes(key)) && <p>URL includes ships outside this roster. Selection is preserved until you change it.</p>}
          {!roster.assignmentEnabled && <p>Fixture assignment is disabled on this server.</p>}
          <small>Roster source: {roster.source} · {roster.version}<br />
            Own ship/defaults: <Link to={`/settings?${new URLSearchParams({ returnTo: location.pathname + location.search })}`}>Settings provenance</Link>
          </small>
        </>}
      </details>
    </aside>
  );
}
