import { useState } from "react";
import moment from "moment-timezone";
import { useLocation } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { createConnectQueryKey } from "@connectrpc/connect-query";
import { readSchedules } from "../gen/app/v1/source_data-SourceDataService_connectquery";
import type { RouteMeta } from "../route-registry";
import {
  accountName,
  accountTime,
  defaultMessageScope,
  roleLabel,
  useSession,
  type AccountSettings,
} from "../components/session";
import { MessageScopeEditor } from "../components/message-scope";
import { StationSummary } from "../components/station-assignment";
import { AppearancePreferences } from "../components/appearance-preferences";
import { SettingsContent } from "../components/settings-content";

export const route: RouteMeta = { path: "/account", label: "Account & settings", order: 20 };

export default function Account() {
  const { session, saveSettings } = useSession();
  const location = useLocation();
  const client = useQueryClient();
  const [edited, setEdited] = useState<AccountSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  if (!session?.user) {
    return <p role="alert">Sign in to view your account.</p>;
  }
  const user = session.user;
  const requestedSection = new URLSearchParams(location.search).get("settings");
  const initialSection =
    user.role === "admin" && (requestedSection === "users" || requestedSection === "ai")
      ? requestedSection
      : "command";
  const settings = edited ?? session.settings;
  const dirty = JSON.stringify(settings) !== JSON.stringify(session.settings);
  function change(update: Partial<AccountSettings>) {
    setEdited({ ...settings, ...update });
    setMessage("");
    setError("");
  }
  async function save() {
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const relevanceChanged =
        JSON.stringify(settings.messageScope ?? defaultMessageScope) !==
        JSON.stringify(session?.settings.messageScope ?? defaultMessageScope);
      await saveSettings(settings);
      if (relevanceChanged) {
        // Drop the old notification snapshot before fetching the newly saved scope.
        await client.resetQueries({
          queryKey: createConnectQueryKey({ schema: readSchedules, cardinality: undefined }),
        });
      }
      setEdited(null);
      setMessage("Settings saved. Your calendar and shift briefing preferences are now active.");
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Settings could not be saved. Please retry."
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="mx-auto max-w-4xl p-6 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Account & settings</h1>
        <p className="text-bc-muted mt-2">
          Your identity, recent sign-ins, and calendar and shift briefing preferences.
        </p>
      </header>
      <section
        className="card border border-base-300 bg-base-100 p-6 gap-4"
        aria-labelledby="account-heading"
      >
        <h2 id="account-heading" className="text-lg font-semibold">
          {accountName(user)}
        </h2>
        <dl className="structured-fields">
          <div>
            <dt>User ID</dt>
            <dd className="font-mono text-sm">{user.id}</dd>
          </div>
          <div>
            <dt>Email</dt>
            <dd>{user.email || "Not supplied"}</dd>
          </div>
          <div>
            <dt>Permission level</dt>
            <dd>{roleLabel(user.role)}</dd>
          </div>
          <div>
            <dt>Latest sign-in</dt>
            <dd>{accountTime(user.lastLoginAt)}</dd>
          </div>
          <div>
            <dt>Previous sign-in</dt>
            <dd>{accountTime(user.previousLoginAt)}</dd>
          </div>
          <div>
            <dt>Account created</dt>
            <dd>{accountTime(user.createdAt)}</dd>
          </div>
        </dl>
        {user.role === "viewer" && (
          <p className="text-sm text-bc-muted">
            You can read schedules and messages and prepare private, unsent drafts.
          </p>
        )}
      </section>
      <StationSummary
        assignment={user.stationAssignment}
        required={session.stationAssignmentRequired}
      />
      <form
        className="card border border-base-300 bg-base-100 p-6 gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <h2 className="text-lg font-semibold">Calendar preferences</h2>
        <fieldset disabled={saving} className="grid gap-4 sm:grid-cols-3">
          <label className="flex flex-col gap-2">
            Display time
            <select
              className="select w-full"
              value={settings.timezone}
              onChange={(event) => change({ timezone: event.target.value })}
            >
              <option value="UTC">Zulu / UTC</option>
              {moment.tz
                .names()
                .filter((zone) => zone !== "UTC")
                .map((zone) => (
                  <option key={zone} value={zone}>
                    {zone}
                  </option>
                ))}
            </select>
          </label>
          <label className="flex flex-col gap-2">
            Automatic refresh
            <select
              className="select w-full"
              value={settings.calendarRefreshSeconds}
              onChange={(event) =>
                change({
                  calendarRefreshSeconds: Number(
                    event.target.value
                  ) as AccountSettings["calendarRefreshSeconds"],
                })
              }
            >
              <option value={0}>Manual only</option>
              <option value={30}>Every 30 seconds</option>
              <option value={60}>Every minute</option>
              <option value={300}>Every 5 minutes</option>
            </select>
          </label>
          <label className="flex flex-col gap-2">
            Default calendar view
            <select
              className="select w-full"
              value={settings.defaultCalendarView}
              onChange={(event) =>
                change({
                  defaultCalendarView: event.target.value as AccountSettings["defaultCalendarView"],
                })
              }
            >
              <option value="day">Day</option>
              <option value="week">Week</option>
              <option value="month">Month</option>
            </select>
          </label>
        </fieldset>
        <p className="text-sm text-bc-muted">
          The calendar refreshes when you sign in or return to the app. Automatic refresh pauses
          while the tab is hidden. Saved views apply when the link does not specify a view.
        </p>
        <MessageScopeEditor
          userId={user.id}
          scope={settings.messageScope ?? defaultMessageScope}
          disabled={saving}
          onChange={(messageScope) => change({ messageScope })}
        />
        <div>
          <button className="btn btn-primary" type="submit" disabled={saving || !dirty}>
            {saving ? "Saving…" : "Save settings"}
          </button>
        </div>
        {message && <p role="status">{message}</p>}
        {error && <p role="alert">{error}</p>}
      </form>
      <section
        className="card border border-base-300 bg-base-100 p-6 gap-4"
        aria-labelledby="appearance-heading"
      >
        <h2 id="appearance-heading" className="text-lg font-semibold">Appearance</h2>
        <AppearancePreferences />
      </section>
      <section
        className="card border border-base-300 bg-base-100 p-6 gap-4"
        aria-labelledby="workspace-settings-heading"
      >
        <h2 id="workspace-settings-heading" className="text-lg font-semibold">Workspace settings</h2>
        <p className="text-sm text-bc-muted">
          {user.role === "admin"
            ? "Manage shared command, AI, and user settings."
            : "View the shared command settings for your watch."}
        </p>
        <SettingsContent includePreferences={false} initialTab={initialSection} />
      </section>
    </div>
  );
}
