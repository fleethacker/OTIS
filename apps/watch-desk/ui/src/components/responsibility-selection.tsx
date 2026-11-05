import { useId } from "react";
import { useResponsibilities } from "./responsibility-data";

export function ResponsibilitySelection({
  selected,
  onChange,
  selectionRequired = false,
}: {
  selected: string[];
  onChange: (ids: string[]) => void;
  selectionRequired?: boolean;
}) {
  const headingId = useId();
  const catalog = useResponsibilities();
  const profiles = catalog.data?.items ?? [];
  const unknown = selected.filter((id) => !profiles.some((profile) => profile.id === id));
  function toggle(id: string, checked: boolean) {
    onChange(checked ? [...selected, id] : selected.filter((value) => value !== id));
  }
  const noCategories =
    selected.length > 0 &&
    !profiles.some((profile) => selected.includes(profile.id) && profile.messageTypes.length > 0);
  return (
    <section className="border-t border-base-300 pt-4 space-y-3" aria-labelledby={headingId}>
      <h3 id={headingId} className="font-semibold">
        Department or watch role
      </h3>
      <p className="text-sm text-bc-muted">
        Administrators define these profiles and their message categories. Selecting profiles
        includes messages in any of their categories, within your command selection.
      </p>
      {catalog.isPending && <p role="status">Loading department and watch profiles…</p>}
      {catalog.isError && (
        <p role="alert">
          Department and watch profiles are unavailable. Your saved selections are unchanged.{" "}
          <button type="button" className="btn btn-xs" onClick={() => void catalog.refetch()}>
            Retry profiles
          </button>
        </p>
      )}
      {!catalog.isPending && !catalog.isError && profiles.length === 0 && (
        <p>No department or watch profiles have been configured yet.</p>
      )}
      <div
        role="group"
        aria-label="Department and watch profiles"
        className="max-h-72 overflow-y-auto space-y-3"
      >
        {profiles.map((profile) => (
          <label className="flex items-start gap-2" key={profile.id}>
            <input
              className="checkbox checkbox-sm"
              type="checkbox"
              checked={selected.includes(profile.id)}
              onChange={(event) => toggle(profile.id, event.target.checked)}
            />
            <span>
              <span className="font-medium">{profile.name}</span>
              <small className="block text-bc-muted">
                {profile.kind === "department" ? "Department" : "Watch role"} ·{" "}
                {profile.messageTypes.length === 0
                  ? "No message categories configured"
                  : profile.messageTypes.join(", ")}
              </small>
            </span>
          </label>
        ))}
        {unknown.map((id) => (
          <label className="flex items-start gap-2 break-all" key={id}>
            <input
              className="checkbox checkbox-sm"
              type="checkbox"
              checked
              onChange={(event) => toggle(id, event.target.checked)}
            />
            <span>
              Saved profile: {id}
              <small className="block text-bc-muted">
                {catalog.isPending
                  ? "Loading profile name…"
                  : "Profile unavailable; selection retained"}
              </small>
            </span>
          </label>
        ))}
      </div>
      {selected.length === 0 ? (
        <p className="text-sm">
          {selectionRequired
            ? "Choose at least one department or watch profile for this station."
            : "No profile selected: all message categories are included within your assigned station."}
        </p>
      ) : unknown.length > 0 && catalog.isSuccess ? (
        <p className="text-sm">
          A saved profile is unavailable. Remove it or ask an administrator to restore it before
          opening your briefing.
        </p>
      ) : noCategories && catalog.isSuccess ? (
        <p className="text-sm">
          These profiles include no message categories, so no messages will match.
        </p>
      ) : (
        <p className="text-sm">Empty profiles do not add message categories.</p>
      )}
    </section>
  );
}

export function ResponsibilitySummary({ selected }: { selected: string[] }) {
  const catalog = useResponsibilities(selected.length > 0);
  if (selected.length === 0) {
    return <p className="text-sm">All message categories</p>;
  }
  const profiles = catalog.data?.items ?? [];
  return (
    <div className="space-y-1 text-sm">
      <p>
        Department / watch:{" "}
        {selected
          .map((id) => profiles.find((profile) => profile.id === id)?.name ?? `Saved profile ${id}`)
          .join(", ")}
      </p>
      {catalog.isError && (
        <p>Profile names are unavailable. Your saved responsibility filters still apply.</p>
      )}
      {catalog.isSuccess &&
      selected.some((id) => !profiles.some((profile) => profile.id === id)) ? (
        <p>A selected profile is unavailable. Update your relevant message settings.</p>
      ) : (
        catalog.isSuccess &&
        !profiles.some(
          (profile) => selected.includes(profile.id) && profile.messageTypes.length > 0
        ) && <p>Selected profiles currently include no message categories.</p>
      )}
    </div>
  );
}
