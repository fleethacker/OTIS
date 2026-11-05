import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import moment from "moment-timezone";
import { useIdentity } from "../hooks/useIdentity";
import { AppButton, Notice, SelectInput, TextInput } from "./ui";
import { AppearancePreferences } from "./appearance-preferences";
import {
  settingsRequest,
  useSettings,
  type CommandSettings,
  type SettingsReply,
} from "./settings-data";
import { commandName, useCommands } from "./command-roster";
import { UNASSIGNED } from "./ship-calendars";
import { WatchSuggestions } from "./watch-suggestions";
/** Comma- or space-separated Zulu times, normalized to the stored ascending list. */
export function parseTurnovers(text: string): string[] {
  const values = text.split(/[\s,]+/).map((v) => v.trim().toUpperCase()).filter(Boolean);
  return [...new Set(values)].sort();
}
interface Options {
  commands: string[];
  aiEndpoints: string[];
  secretRefs: string[];
}
interface User {
  id: string;
  username: string;
  email: string;
  role: string;
  enabled: boolean;
  lastLogin: string;
  revision: string;
}
interface Users {
  users: User[];
  nextAfter: string | null;
}
export function SettingsContent({ active = true }: { active?: boolean }) {
  const { role } = useIdentity();
  const { shared, timezone } = useSettings();
  const [tab, setTab] = useState("preferences");
  const [zone, setZone] = useState(timezone);
  const [form, setForm] = useState<CommandSettings | undefined>(shared?.settings);
  const [revision, setRevision] = useState(shared?.revision);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");
  const [failure, setFailure] = useState("");
  const [turnovers, setTurnovers] = useState((shared?.settings.turnoverUtc ?? []).join(", "));
  const client = useQueryClient();
  const roster = useCommands();
  const admin = role === "admin";
  const options = useQuery({
    queryKey: ["settings", "options"],
    queryFn: () => settingsRequest<Options>("options"),
    enabled: admin && active,
    retry: false,
  });
  const dirty = zone !== timezone || JSON.stringify(form) !== JSON.stringify(shared?.settings);
  useEffect(() => {
    if (!dirty) {
      return;
    }
    const leave = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, [dirty]);
  async function run(action: () => Promise<void>, success: string) {
    setPending(true);
    setFailure("");
    setNotice("");
    try {
      await action();
      setNotice(success);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "Could not save. Retry.");
    } finally {
      setPending(false);
    }
  }
  function update<K extends keyof CommandSettings>(key: K, value: CommandSettings[K]) {
    if (form) {
      setForm({ ...form, [key]: value });
    }
    setNotice("");
  }
  function load(result: SettingsReply) {
    client.setQueryData(["settings", "shared"], result);
    setForm(result.settings);
    setRevision(result.revision);
    setTurnovers(result.settings.turnoverUtc.join(", "));
    // Own ship marks come from the shared settings.
    void client.invalidateQueries({ queryKey: ["watchdesk-commands"] });
  }
  async function saveCommand() {
    load(await settingsRequest<SettingsReply>("update", { settings: form, revision }));
  }
  if (!form) {
    return <p role="status">Loading…</p>;
  }
  return (
    <div className="settings-content">
      <nav aria-label="Settings sections">
        {["preferences", "command", ...(admin ? ["ai", "users"] : [])].map((value) => (
          <AppButton
            size="sm"
            type="button"
            key={value}
            aria-pressed={tab === value}
            onClick={() => {
              setTab(value);
              setNotice("");
              setFailure("");
            }}
          >
            {{ preferences: "Preferences", command: "Command", ai: "AI", users: "Users" }[value]}
          </AppButton>
        ))}
        {dirty && <span className="badge badge-warning settings-unsaved">Unsaved</span>}
      </nav>
      {failure && (
        <Notice tone="error" role="alert">
          {failure}
        </Notice>
      )}
      {notice && (
        <Notice tone="success" role="status">
          {notice}
        </Notice>
      )}
      {tab === "preferences" && (
        <>
          <AppearancePreferences />
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await settingsRequest("save-preferences", { timezone: zone });
                client.setQueryData(["settings", "preferences"], { timezone: zone });
              }, "Saved");
            }}
          >
            <label>
              Timezone
              <SelectInput
                className="select-sm"
                value={zone}
                onChange={(e) => {
                  setZone(e.target.value);
                  setNotice("");
                }}
              >
                {["UTC", ...moment.tz.names().filter((v) => v !== "UTC")].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </SelectInput>
            </label>
            <div className="settings-actions">
              <AppButton
                variant="primary"
                size="sm"
                type="submit"
                disabled={pending || zone === timezone}
              >
                Save
              </AppButton>
            </div>
          </form>
        </>
      )}
      {tab === "command" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(saveCommand, "Saved");
          }}
        >
          <fieldset disabled={!admin || pending}>
            <label>
              Ship
              <TextInput
                className="input-sm"
                maxLength={120}
                value={form.shipName}
                onChange={(e) => update("shipName", e.target.value)}
              />
            </label>
            <label>
              Unit
              <TextInput
                className="input-sm"
                maxLength={120}
                value={form.unitName}
                onChange={(e) => update("unitName", e.target.value)}
              />
            </label>
            <label>
              Outgoing command
              <TextInput
                className="input-sm"
                maxLength={30}
                value={form.outgoingCommand}
                onChange={(e) => update("outgoingCommand", e.target.value.toUpperCase())}
              />
            </label>
            <label>
              Action authority
              <TextInput
                className="input-sm"
                maxLength={50}
                value={form.actionAuthority}
                onChange={(e) => update("actionAuthority", e.target.value.toUpperCase())}
              />
            </label>
            <label>
              Calendar commands
              <SelectInput
                className="select-sm settings-commands"
                multiple
                value={form.commandIds}
                onChange={(e) =>
                  update(
                    "commandIds",
                    [...e.target.selectedOptions].map((v) => v.value)
                  )
                }
              >
                {[...new Set([...(options.data?.commands ?? []), ...form.commandIds])].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </SelectInput>
            </label>
            <label>
              Own ship
              <SelectInput
                className="select-sm"
                value={form.commandIds[0] ?? ""}
                onChange={(e) =>
                  update(
                    "commandIds",
                    e.target.value
                      ? [e.target.value, ...form.commandIds.filter((v) => v !== e.target.value)]
                      : form.commandIds
                  )
                }
              >
                {form.commandIds.length === 0 && <option value="">Not set</option>}
                {[...new Set([...form.commandIds, ...(options.data?.commands ?? [])])].map((v) => (
                  <option key={v} value={v}>
                    {commandName(`unit:${v}`, roster.data?.commands ?? [])}
                  </option>
                ))}
              </SelectInput>
            </label>
            <label>
              Operation / exercise
              <TextInput
                className="input-sm"
                maxLength={128}
                placeholder="Not set"
                value={form.operationName}
                onChange={(e) => update("operationName", e.target.value)}
              />
            </label>
            <label>
              Group / command
              <TextInput
                className="input-sm"
                maxLength={128}
                placeholder="Not set"
                value={form.groupCommand}
                onChange={(e) => update("groupCommand", e.target.value)}
              />
            </label>
            <label>
              UTC watch turnovers
              <TextInput
                className="input-sm"
                maxLength={192}
                aria-label="UTC watch turnovers"
                placeholder="Not set"
                value={turnovers}
                onChange={(e) => {
                  setTurnovers(e.target.value);
                  update("turnoverUtc", parseTurnovers(e.target.value));
                }}
              />
              <small>Zulu times separated by commas, e.g. 0000Z, 0400Z.</small>
            </label>
            <div className="settings-default-ships" role="group" aria-label="Default visible ships">
              <span>Default visible ships</span>
              <div className="context-ship-options">
                {[...(roster.data?.commands ?? []).map((c) => `unit:${c.id}`), UNASSIGNED].map((key) => (
                  <label key={key}>
                    <input
                      type="checkbox"
                      checked={form.defaultShips.includes(key)}
                      onChange={(e) =>
                        update(
                          "defaultShips",
                          (e.target.checked
                            ? [...form.defaultShips, key]
                            : form.defaultShips.filter((v) => v !== key)
                          ).sort()
                        )
                      }
                    />
                    {commandName(key, roster.data?.commands ?? [])}
                  </label>
                ))}
              </div>
              <small>
                {form.defaultShips.length === 0 ? "Not set: every ship is shown. " : ""}
                Choose “Use app defaults” in Ships to apply this list.
              </small>
            </div>
          </fieldset>
          {options.isError && (
            <Notice tone="error" role="alert">
              Commands unavailable.
            </Notice>
          )}
          {admin && (
            <div className="settings-actions">
              <AppButton variant="primary" size="sm" type="submit" disabled={pending}>
                Save
              </AppButton>
              <AppButton
                size="sm"
                type="button"
                disabled={pending}
                onClick={() =>
                  void run(async () => {
                    load(await settingsRequest<SettingsReply>("get"));
                  }, "Reloaded")
                }
              >
                Reload
              </AppButton>
            </div>
          )}
        </form>
      )}
      {tab === "command" && admin && (
        <WatchSuggestions
          active={active}
          current={form.operationName}
          revision={revision}
          dirty={dirty}
          onSaved={load}
        />
      )}
      {tab === "ai" && admin && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(saveCommand, "Saved");
          }}
        >
          <label>
            Connection
            <SelectInput
              className="select-sm"
              value={form.ai?.endpoint ?? ""}
              onChange={(e) =>
                update(
                  "ai",
                  e.target.value
                    ? {
                        endpoint: e.target.value,
                        model: form.ai?.model ?? "",
                        secretRef: form.ai?.secretRef ?? "",
                      }
                    : null
                )
              }
            >
              <option value="">Not configured</option>
              {options.data?.aiEndpoints.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </SelectInput>
          </label>
          {form.ai && (
            <>
              <label>
                Model
                <TextInput
                  className="input-sm"
                  required
                  maxLength={128}
                  value={form.ai.model}
                  onChange={(e) => {
                    if (form.ai) {
                      update("ai", { ...form.ai, model: e.target.value });
                    }
                  }}
                />
              </label>
              <label>
                Credential
                <SelectInput
                  className="select-sm"
                  value={form.ai.secretRef}
                  onChange={(e) => {
                    if (form.ai) {
                      update("ai", { ...form.ai, secretRef: e.target.value });
                    }
                  }}
                >
                  <option value="">None</option>
                  {options.data?.secretRefs.map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </SelectInput>
              </label>
            </>
          )}
          <div className="settings-actions">
            <AppButton variant="primary" size="sm" type="submit" disabled={pending}>
              Save
            </AppButton>
            <AppButton
              size="sm"
              type="button"
              disabled={
                pending || !form.ai || JSON.stringify(form) !== JSON.stringify(shared?.settings)
              }
              onClick={() =>
                void run(async () => {
                  await settingsRequest("test-ai");
                }, "Connected")
              }
            >
              Test connection
            </AppButton>
          </div>
        </form>
      )}
      {tab === "users" && admin && <UserSettings active={active} />}
    </div>
  );
}
function UserSettings({ active }: { active: boolean }) {
  const [after, setAfter] = useState<string | null>(null);
  const [failure, setFailure] = useState("");
  const [pending, setPending] = useState(false);
  const users = useQuery({
    queryKey: ["settings", "users", after],
    queryFn: () => settingsRequest<Users>("users", { after }),
    enabled: active,
    retry: false,
  });
  async function action(user: User, value: string) {
    setPending(true);
    setFailure("");
    try {
      await settingsRequest("update-user", {
        user: user.id,
        revision: user.revision,
        action: value,
      });
      await users.refetch();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "Could not update user.");
    } finally {
      setPending(false);
    }
  }
  const { timezone } = useSettings();
  return (
    <section aria-label="Users">
      {(failure || users.isError) && (
        <Notice tone="error" role="alert">
          {failure || "Users unavailable."}
        </Notice>
      )}
      {users.isPending ? (
        <p role="status">Loading…</p>
      ) : (
        <>
          <div className="settings-user-list">
            {users.data?.users.map((user) => (
              <article key={user.id}>
                <div>
                  <strong>{user.username}</strong>
                  <small>{user.email}</small>
                  <small>
                    {user.lastLogin
                      ? moment.tz(user.lastLogin, timezone).format("DD MMM YYYY HH:mm z")
                      : ""}
                  </small>
                </div>
                <span className="badge badge-outline">
                  {user.role === "admin" ? "Admin" : "Viewer"}
                </span>
                <span className="badge badge-outline">{user.enabled ? "Active" : "Disabled"}</span>
                <AppButton
                  size="sm"
                  disabled={pending}
                  onClick={() => void action(user, user.enabled ? "disable" : "enable")}
                >
                  {user.enabled ? "Disable" : "Enable"}
                </AppButton>
                <AppButton size="sm" disabled={pending} onClick={() => void action(user, "revoke")}>
                  Revoke sessions
                </AppButton>
              </article>
            ))}
          </div>
          <div className="settings-actions">
            {after !== null && (
              <AppButton size="sm" onClick={() => setAfter(null)}>
                First page
              </AppButton>
            )}
            {users.data?.nextAfter !== null && users.data?.nextAfter !== undefined && (
              <AppButton size="sm" onClick={() => setAfter(users.data?.nextAfter ?? null)}>
                Next
              </AppButton>
            )}
          </div>
        </>
      )}
    </section>
  );
}
