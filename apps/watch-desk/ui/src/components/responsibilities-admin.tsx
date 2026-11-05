import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { accountRequest, usePermission } from "./session";
import { useResponsibilities, type ResponsibilityProfile } from "./responsibility-data";
type Draft = Omit<ResponsibilityProfile, "id"> & { id?: string };
const empty: Draft = { name: "", kind: "department", messageTypes: [] };
export function ResponsibilitiesAdmin() {
  const allowed = usePermission("users:manage");
  const result = useResponsibilities(allowed);
  const client = useQueryClient();
  const [draft, setDraft] = useState<Draft>(empty);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  if (!allowed) {
    return null;
  }
  const categories = [
    ...new Set([...(result.data?.messageTypes ?? []), ...draft.messageTypes]),
  ].sort();
  function change(update: Partial<Draft>) {
    setDraft({ ...draft, ...update });
    setMessage("");
    setError("");
  }
  async function save() {
    setSaving(true);
    setMessage("");
    setError("");
    try {
      await accountRequest(
        "/api/v1/briefing/responsibilities" +
          (draft.id === undefined ? "" : `/${encodeURIComponent(draft.id)}`),
        {
          method: draft.id === undefined ? "POST" : "PATCH",
          body: JSON.stringify({
            name: draft.name.trim(),
            kind: draft.kind,
            messageTypes: draft.messageTypes,
          }),
        }
      );
      setDraft(empty);
      setMessage("Responsibility saved. People can select it in Account & settings.");
      await client.invalidateQueries({ queryKey: ["briefing-responsibilities"] });
      await client.invalidateQueries({ queryKey: ["shift-briefing"] });
      await client.resetQueries({ queryKey: ["parse-command-source"] });
      await client.resetQueries({ queryKey: ["parse-command-evidence"] });
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Responsibility could not be saved. Please retry."
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <section
      className="card border border-base-300 bg-base-100 p-5 gap-5"
      aria-labelledby="responsibility-heading"
    >
      <h2 id="responsibility-heading" className="text-xl font-semibold">
        Departments and watch roles
      </h2>
      <p className="text-sm text-bc-muted">
        Define the message categories for each responsibility. People select their responsibilities
        in Account & settings, alongside their commands. These choices filter briefings and do not
        grant application permissions.
      </p>
      {result.isPending && <p role="status">Loading responsibilities…</p>}
      {result.isError && (
        <div role="alert">
          Responsibilities could not be loaded. {result.error.message}{" "}
          <button className="btn btn-sm" type="button" onClick={() => void result.refetch()}>
            Retry responsibilities
          </button>
        </div>
      )}
      {result.data?.items.length === 0 && (
        <p>No departments or watch roles have been defined yet.</p>
      )}
      <ul className="space-y-3">
        {result.data?.items.map((profile) => (
          <li
            key={profile.id}
            className="rounded-box border border-base-300 p-4 flex flex-wrap justify-between gap-3"
          >
            <div className="min-w-0 space-y-1">
              <h3 className="font-semibold break-words">{profile.name}</h3>
              <p className="text-sm">
                {profile.kind === "department" ? "Department" : "Watch role"}
              </p>
              <p className="text-sm break-words">
                {profile.messageTypes.length === 0
                  ? "No message categories selected — this responsibility matches no messages."
                  : profile.messageTypes.join(", ")}
              </p>
            </div>
            <button
              className="btn btn-sm"
              type="button"
              disabled={saving}
              aria-label={`Edit ${profile.name}`}
              onClick={() => {
                setDraft(profile);
                setError("");
                setMessage("");
              }}
            >
              Edit
            </button>
          </li>
        ))}
      </ul>
      <form
        className="border-t border-base-300 pt-5 space-y-4"
        aria-label="Responsibility definition"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <h3 className="font-semibold">
          {draft.id === undefined ? "Add a responsibility" : `Edit ${draft.name}`}
        </h3>
        <fieldset disabled={saving || result.isPending || result.isError} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-2">
              Responsibility name
              <input
                className="input w-full"
                value={draft.name}
                maxLength={100}
                required
                onChange={(event) => change({ name: event.target.value })}
              />
            </label>
            <label className="flex flex-col gap-2">
              Responsibility kind
              <select
                className="select w-full"
                value={draft.kind}
                onChange={(event) => change({ kind: event.target.value as Draft["kind"] })}
              >
                <option value="department">Department</option>
                <option value="watch_role">Watch role</option>
              </select>
            </label>
          </div>
          <fieldset className="space-y-3">
            <legend className="font-medium mb-2">Matching message categories</legend>
            <p className="text-sm text-bc-muted">
              Select every category covered by this responsibility. Names alone do not assign
              categories.
            </p>
            {result.data?.observedTypesAvailable === false && (
              <p className="text-sm">
                Additional message categories could not be checked. Supported and saved categories
                are still shown.
              </p>
            )}
            {result.data?.messageTypesLimited === true && (
              <p className="text-sm">
                The additional category list is limited. Saved categories remain included.
              </p>
            )}
            <div className="grid gap-2 sm:grid-cols-2 max-h-72 overflow-y-auto">
              {categories.map((category) => (
                <label className="flex items-start gap-2 break-words" key={category}>
                  <input
                    className="checkbox checkbox-sm"
                    type="checkbox"
                    checked={draft.messageTypes.includes(category)}
                    onChange={(event) =>
                      change({
                        messageTypes: event.target.checked
                          ? [...draft.messageTypes, category]
                          : draft.messageTypes.filter((value) => value !== category),
                      })
                    }
                  />
                  {category}
                </label>
              ))}
            </div>
            {draft.messageTypes.length === 0 && (
              <p className="text-sm">
                This responsibility will match no messages until categories are selected.
              </p>
            )}
          </fieldset>
          <div className="flex gap-3">
            <button
              className="btn btn-primary"
              type="submit"
              disabled={saving || draft.name.trim() === ""}
            >
              {saving ? "Saving…" : "Save responsibility"}
            </button>
            {draft.id !== undefined && (
              <button
                className="btn"
                type="button"
                onClick={() => {
                  setDraft(empty);
                  setError("");
                  setMessage("");
                }}
              >
                Cancel edit
              </button>
            )}
          </div>
        </fieldset>
        {message && <p role="status">{message}</p>}
        {error && <p role="alert">{error}</p>}
      </form>
    </section>
  );
}
