import { useQuery } from "@tanstack/react-query";
import { accountRequest, type MessageScope } from "./session";
import { ResponsibilitySelection } from "./responsibility-selection";

export function MessageScopeEditor({
  scope,
  onChange,
  userId,
  disabled,
}: {
  scope: MessageScope;
  onChange: (scope: MessageScope) => void;
  userId: string;
  disabled: boolean;
}) {
  const options = useQuery({
    queryKey: ["briefing-command-options", userId],
    queryFn: async ({ signal }) => {
      const data = await accountRequest<{ commandIds: string[]; limited: boolean }>(
        "/api/v1/briefing/commands",
        { signal }
      );
      if (
        !Array.isArray(data.commandIds) ||
        !data.commandIds.every((id) => typeof id === "string")
      ) {
        throw new Error("Command choices could not be loaded.");
      }
      return data;
    },
    retry: false,
    staleTime: 30_000,
  });
  const available = options.data?.commandIds ?? [];
  const commands = [...new Set([...available, ...scope.commandIds])].sort();
  return (
    <fieldset disabled={disabled} className="space-y-4 border-t border-base-300 pt-5">
      <legend className="text-lg font-semibold pt-5">Relevant messages</legend>
      <p className="text-sm text-bc-muted">
        Choose the commands to include in your shift briefing. Messages without an assigned command
        can be included separately.
      </p>
      <label className="flex items-center gap-2">
        <input
          className="checkbox"
          type="checkbox"
          checked={scope.allCommands}
          onChange={(event) => onChange({ ...scope, allCommands: event.target.checked })}
        />
        All assigned commands
      </label>
      {!scope.allCommands && (
        <div className="space-y-2">
          {options.isPending && <p role="status">Loading command choices…</p>}
          {options.isError && (
            <p role="alert">
              Command choices unavailable. Saved selections are retained.{" "}
              <button className="btn btn-xs" type="button" onClick={() => void options.refetch()}>
                Retry command choices
              </button>
            </p>
          )}
          {!options.isPending && !options.isError && commands.length === 0 && (
            <p>No assigned commands are available yet.</p>
          )}
          {options.data?.limited === true && (
            <p className="text-sm">
              Showing the available command choices up to the source limit. Your saved selections
              remain included.
            </p>
          )}
          <div
            className="max-h-64 overflow-y-auto space-y-2"
            role="group"
            aria-label="Selected commands"
          >
            {commands.map((command) => (
              <label className="flex items-start gap-2 break-all" key={command}>
                <input
                  className="checkbox checkbox-sm"
                  type="checkbox"
                  checked={scope.commandIds.includes(command)}
                  onChange={(event) =>
                    onChange({
                      ...scope,
                      commandIds: event.target.checked
                        ? [...scope.commandIds, command]
                        : scope.commandIds.filter((id) => id !== command),
                    })
                  }
                />
                <span>
                  {command}
                  {!available.includes(command) && (
                    <small className="text-bc-muted"> · Saved selection</small>
                  )}
                </span>
              </label>
            ))}
          </div>
          {scope.commandIds.length === 0 && (
            <p className="text-sm">No assigned commands selected.</p>
          )}
        </div>
      )}
      <label className="flex items-center gap-2">
        <input
          className="checkbox"
          type="checkbox"
          checked={scope.includeUnassigned}
          onChange={(event) => onChange({ ...scope, includeUnassigned: event.target.checked })}
        />
        Include messages with no assigned command
      </label>
      {!scope.allCommands && scope.commandIds.length === 0 && !scope.includeUnassigned && (
        <p className="text-sm">This selection will show no messages in your shift briefing.</p>
      )}
      <ResponsibilitySelection
        selected={scope.responsibilityIds ?? []}
        onChange={(responsibilityIds) => onChange({ ...scope, responsibilityIds })}
      />
    </fieldset>
  );
}
