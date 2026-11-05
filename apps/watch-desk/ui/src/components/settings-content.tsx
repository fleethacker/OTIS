import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import moment from "moment-timezone";
import { useIdentity } from "../hooks/useIdentity";
import {
  settingsRequest,
  useSettings,
  type CommandSettings,
  type SettingsReply,
} from "./settings-data";
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
  const client = useQueryClient();
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
  async function saveCommand() {
    const result = await settingsRequest<SettingsReply>("update", { settings: form, revision });
    client.setQueryData(["settings", "shared"], result);
    setForm(result.settings);
    setRevision(result.revision);
  }
  if (!form) {
    return <p role="status">Loading…</p>;
  }
  return (
    <div className="settings-content">
      <nav aria-label="Settings sections">
        {["preferences", "command", ...(admin ? ["ai", "users"] : [])].map((value) => (
          <button
            className="btn btn-sm"
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
          </button>
        ))}
        {dirty && <span className="status-pill settings-unsaved">Unsaved</span>}
      </nav>
      {failure && (
        <div role="alert" className="alert">
          {failure}
        </div>
      )}
      {notice && <p role="status">{notice}</p>}
      {tab === "preferences" && (
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
            <select
              className="select select-sm"
              value={zone}
              onChange={(e) => {
                setZone(e.target.value);
                setNotice("");
              }}
            >
              {["UTC", ...moment.tz.names().filter((v) => v !== "UTC")].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
          <div className="settings-actions">
            <button className="btn btn-primary btn-sm" disabled={pending || zone === timezone}>
              Save
            </button>
          </div>
        </form>
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
              <input
                className="input input-sm"
                maxLength={120}
                value={form.shipName}
                onChange={(e) => update("shipName", e.target.value)}
              />
            </label>
            <label>
              Unit
              <input
                className="input input-sm"
                maxLength={120}
                value={form.unitName}
                onChange={(e) => update("unitName", e.target.value)}
              />
            </label>
            <label>
              Outgoing command
              <input
                className="input input-sm"
                maxLength={30}
                value={form.outgoingCommand}
                onChange={(e) => update("outgoingCommand", e.target.value.toUpperCase())}
              />
            </label>
            <label>
              Action authority
              <input
                className="input input-sm"
                maxLength={50}
                value={form.actionAuthority}
                onChange={(e) => update("actionAuthority", e.target.value.toUpperCase())}
              />
            </label>
            <label>
              Calendar commands
              <select
                className="select select-sm settings-commands"
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
              </select>
            </label>
          </fieldset>
          {options.isError && <p role="alert">Commands unavailable.</p>}
          {admin && (
            <div className="settings-actions">
              <button className="btn btn-primary btn-sm" disabled={pending}>
                Save
              </button>
              <button
                className="btn btn-sm"
                type="button"
                disabled={pending}
                onClick={() =>
                  void run(async () => {
                    const value = await settingsRequest<SettingsReply>("get");
                    client.setQueryData(["settings", "shared"], value);
                    setForm(value.settings);
                    setRevision(value.revision);
                  }, "Reloaded")
                }
              >
                Reload
              </button>
            </div>
          )}
        </form>
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
            <select
              className="select select-sm"
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
            </select>
          </label>
          {form.ai && (
            <>
              <label>
                Model
                <input
                  className="input input-sm"
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
                <select
                  className="select select-sm"
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
                </select>
              </label>
            </>
          )}
          <div className="settings-actions">
            <button className="btn btn-primary btn-sm" disabled={pending}>
              Save
            </button>
            <button
              className="btn btn-sm"
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
            </button>
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
      {(failure || users.isError) && <p role="alert">{failure || "Users unavailable."}</p>}
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
                <span className="status-pill">{user.role === "admin" ? "Admin" : "Viewer"}</span>
                <span className="status-pill">{user.enabled ? "Active" : "Disabled"}</span>
                <button
                  className="btn btn-sm"
                  disabled={pending}
                  onClick={() => void action(user, user.enabled ? "disable" : "enable")}
                >
                  {user.enabled ? "Disable" : "Enable"}
                </button>
                <button
                  className="btn btn-sm"
                  disabled={pending}
                  onClick={() => void action(user, "revoke")}
                >
                  Revoke sessions
                </button>
              </article>
            ))}
          </div>
          <div className="settings-actions">
            {after !== null && (
              <button className="btn btn-sm" onClick={() => setAfter(null)}>
                First page
              </button>
            )}
            {users.data?.nextAfter !== null && users.data?.nextAfter !== undefined && (
              <button
                className="btn btn-sm"
                onClick={() => setAfter(users.data?.nextAfter ?? null)}
              >
                Next
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
