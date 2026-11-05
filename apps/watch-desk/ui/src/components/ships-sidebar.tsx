import { useId, useState } from "react";
import { TbChevronLeft, TbChevronRight, TbDots } from "react-icons/tb";
import { UNASSIGNED } from "./ship-calendars";
import { commandColor, commandName, type CommandRoster } from "./command-roster";
import { Popover } from "./popover";
import { AppButton, TextInput } from "./ui";
import { useCalendarPreference } from "./calendar-preferences";

export function ShipsSidebar({ roster, selected, pending, error, retry, onChange, onReset }: {
  roster?: CommandRoster;
  selected?: Set<string>;
  pending: boolean;
  error?: string;
  retry: () => void;
  onChange: (selection: Set<string> | undefined) => void;
  onReset: () => void;
}) {
  const [search, setSearch] = useState("");
  const panelId = useId();
  const [open, setOpen] = useCalendarPreference("shipsOpen");
  const commands = roster?.commands ?? [];
  const keys = [...commands.map((c) => `unit:${c.id}`), UNASSIGNED];
  const active = selected ?? new Set(keys);
  const selectedCount = keys.filter((key) => active.has(key)).length;
  const unavailableCount = selected ? [...selected].filter((key) => !keys.includes(key)).length : 0;
  const searchTerm = search.trim().toLowerCase();
  const name = (key: string) => key === UNASSIGNED ? "Unassigned" : commandName(key, commands);
  const matches = (key: string) => name(key).toLowerCase().includes(searchTerm);
  const groups = new Map<string, string[]>();
  for (const command of [...commands].sort((a, b) => Number(b.isOwnShip) - Number(a.isOwnShip) || a.group.localeCompare(b.group) || a.name.localeCompare(b.name))) {
    const group = command.isOwnShip ? "Own ship" : command.group;
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group)!.push(`unit:${command.id}`);
  }
  function toggle(values: string[], checked: boolean) {
    const next = new Set(active);
    for (const key of values) checked ? next.add(key) : next.delete(key);
    onChange(next);
  }
  function choice(key: string) {
    return (
      <div className="ship-choice" key={key}>
        <label>
          <input type="checkbox" checked={active.has(key)} onChange={(event) => toggle([key], event.target.checked)} />
          <span className="ship-swatch" style={{ backgroundColor: commandColor(key, commands) }} aria-hidden="true" />
          <span>{name(key)}</span>
        </label>
        <AppButton size="xs" variant="ghost" className="ship-only" aria-label={`Only ${name(key)}`} onClick={() => onChange(new Set([key]))}>
          Only
        </AppButton>
      </div>
    );
  }
  return (
    <aside className="ships-sidebar" aria-label="Ship calendars" data-expanded={open}>
      <header className="ships-header">
        {open && <h2>Ships <small title={`${selectedCount} of ${keys.length} selected`}>{selectedCount}/{keys.length}</small></h2>}
        {open && roster && !error && (
          <Popover label="Ship calendar options" align="end" trigger={<TbDots aria-hidden="true" />}>
            {({ close }) => (
              <div className="ship-calendar-options">
                <AppButton size="xs" variant="ghost" aria-label="Select all" onClick={() => { onChange(undefined); close(); }}>All</AppButton>
                <AppButton size="xs" variant="ghost" aria-label="Clear all" onClick={() => { onChange(new Set()); close(); }}>None</AppButton>
                <AppButton size="xs" variant="ghost" aria-label="Use app defaults" onClick={() => { onReset(); close(); }}>Defaults</AppButton>
              </div>
            )}
          </Popover>
        )}
        <AppButton
          size="xs"
          variant="ghost"
          className="ships-toggle"
          aria-label={open ? "Collapse ship calendars" : "Expand ship calendars"}
          title={open ? "Collapse ship calendars" : "Expand ship calendars"}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? <TbChevronLeft aria-hidden="true" /> : <TbChevronRight aria-hidden="true" />}
        </AppButton>
      </header>
      <div className="ships-content" id={panelId} hidden={!open}>
        {pending && <p aria-live="polite">Loading ships…</p>}
        {error && <div className="ships-error" role="alert">Ships unavailable. <AppButton size="xs" onClick={retry} aria-label="Retry roster">Retry</AppButton></div>}
        {roster && !error && <>
          {commands.length > 6 && <TextInput className="ship-search input-sm" aria-label="Find ship" placeholder="Find ship" type="search" value={search} onChange={(event) => setSearch(event.target.value)} />}
          <div className="ship-list">
            {[...groups].map(([group, values]) => {
              const visible = values.filter(matches);
              if (!visible.length) return null;
              return <fieldset key={group}>
                <legend><label><input type="checkbox"
                  checked={visible.every((key) => active.has(key))}
                  ref={(node) => { if (node) node.indeterminate = visible.some((key) => active.has(key)) && !visible.every((key) => active.has(key)); }}
                  onChange={(event) => toggle(visible, event.target.checked)} />{group}</label></legend>
                {visible.map(choice)}
              </fieldset>;
            })}
            {matches(UNASSIGNED) && choice(UNASSIGNED)}
            {!keys.some(matches) && <p role="status">No ships found.</p>}
          </div>
          {unavailableCount > 0 && <p className="ships-warning" role="status">{unavailableCount} unavailable {unavailableCount === 1 ? "ship" : "ships"} selected</p>}
        </>}
      </div>
    </aside>
  );
}
