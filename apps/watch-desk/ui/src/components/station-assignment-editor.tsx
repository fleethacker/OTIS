import { useId, useState } from "react";
import { ResponsibilitySelection } from "./responsibility-selection";
import { emptyStation, type StationDraft } from "./station-assignment-data";

export function StationAssignmentEditor({
  value,
  onChange,
  name,
  disabled,
}: {
  value: StationDraft | null;
  onChange: (value: StationDraft | null) => void;
  name: string;
  disabled: boolean;
}) {
  const id = useId();
  const [commands, setCommands] = useState(value?.commandIds.join("\n") ?? "");
  function change(update: Partial<StationDraft>) {
    onChange({ ...(value ?? emptyStation), ...update });
  }
  return (
    <fieldset disabled={disabled} className="space-y-4 border-t border-base-300 pt-4">
      <legend className="font-semibold pt-4">Assigned station</legend>
      <label className="flex items-center gap-2">
        <input
          className="checkbox"
          type="checkbox"
          aria-label={`Assign a station for ${name}`}
          checked={value !== null}
          onChange={(event) => {
            setCommands("");
            onChange(event.target.checked ? { ...emptyStation } : null);
          }}
        />
        Assign a ship, department, and watch station
      </label>
      {value !== null && (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="flex flex-col gap-2" htmlFor={`${id}-ship`}>
              Ship / command name
              <input
                id={`${id}-ship`}
                className="input w-full"
                required
                maxLength={100}
                value={value.shipName}
                onChange={(event) => change({ shipName: event.target.value })}
              />
            </label>
            <label className="flex flex-col gap-2" htmlFor={`${id}-department`}>
              Department
              <input
                id={`${id}-department`}
                className="input w-full"
                required
                maxLength={100}
                value={value.department}
                onChange={(event) => change({ department: event.target.value })}
              />
            </label>
            <label className="flex flex-col gap-2" htmlFor={`${id}-watch`}>
              Watch station
              <input
                id={`${id}-watch`}
                className="input w-full"
                required
                maxLength={100}
                value={value.watchStation}
                onChange={(event) => change({ watchStation: event.target.value })}
              />
            </label>
          </div>
          <label className="flex flex-col gap-2" htmlFor={`${id}-commands`}>
            Exact command IDs, one per line
            <textarea
              id={`${id}-commands`}
              className="textarea w-full"
              rows={3}
              required
              value={commands}
              onChange={(event) => {
                setCommands(event.target.value);
                change({
                  commandIds: [
                    ...new Set(
                      event.target.value
                        .split(/\r?\n/)
                        .map((line) => line.trim())
                        .filter((line) => line !== "")
                    ),
                  ],
                });
              }}
            />
          </label>
          <p className="text-sm text-bc-muted">
            Use the command IDs supplied by the message source. The ship name is a display label; it
            does not create a command match.
          </p>
          <label className="flex items-center gap-2">
            <input
              className="checkbox"
              type="checkbox"
              checked={value.includeUnassigned}
              onChange={(event) => change({ includeUnassigned: event.target.checked })}
            />
            Include messages without an assigned command
          </label>
          <ResponsibilitySelection
            selected={value.responsibilityIds}
            selectionRequired
            onChange={(responsibilityIds) => change({ responsibilityIds })}
          />
        </>
      )}
    </fieldset>
  );
}
