import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { RouteMeta } from "../route-registry";
import { ResponsibilitiesAdmin } from "../components/responsibilities-admin";
import { StationAssignmentEditor } from "../components/station-assignment-editor";
import {
  editableStation,
  validStation,
  type StationDraft,
} from "../components/station-assignment-data";
import {
  accountRequest,
  accountName,
  accountTime,
  usePermission,
  useSession,
  type AccountUser,
  roleLabel,
} from "../components/session";

export const route: RouteMeta = {
  path: "/users",
  label: "User management",
  order: 30,
  hideFromNav: true,
};

export default function Users() {
  const allowed = usePermission("users:manage");
  const { session } = useSession();
  const result = useQuery({
    queryKey: ["account-users", session?.user?.id],
    queryFn: ({ signal }) => accountRequest<{ users: AccountUser[] }>("/api/v1/users", { signal }),
    enabled: allowed,
    retry: false,
  });
  if (!allowed) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-semibold">User management</h1>
        <p role="alert" className="mt-4">
          Administrator access is required to manage users.
        </p>
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-6xl p-6 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">User management</h1>
        <p className="text-bc-muted mt-2">
          Accounts appear after their first sign-in. Assign their watch station and department here.
        </p>
      </header>
      <p className="text-sm">
        Viewers can read schedules and messages and prepare private, unsent drafts. Administrators
        also manage shared settings and station assignments. Permission levels come from the sign-in
        provider. Use{" "}
        <Link className="link" to="/account?settings=users">
          Settings · Users
        </Link>{" "}
        to enable, disable, or revoke an account.
      </p>
      {result.isPending && <p role="status">Loading users…</p>}
      {result.isError && (
        <div role="alert">
          Users could not be loaded. {result.error.message}{" "}
          <button className="btn btn-sm" onClick={() => void result.refetch()}>
            Retry
          </button>
        </div>
      )}
      {result.data?.users.length === 0 && <p>No accounts have signed in yet.</p>}
      <div className="space-y-3">
        {result.data?.users.map((user) => (
          <UserCard
            key={`${user.id}:${user.role}:${user.active}:${JSON.stringify(user.stationAssignment)}`}
            user={user}
          />
        ))}
      </div>
      <ResponsibilitiesAdmin />
    </div>
  );
}
function UserCard({ user }: { user: AccountUser }) {
  const [station, setStation] = useState<StationDraft | null | undefined>();
  const assigned = station === undefined ? editableStation(user.stationAssignment) : station;
  const stationChanged =
    JSON.stringify(assigned) !== JSON.stringify(editableStation(user.stationAssignment));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const client = useQueryClient();
  const { session, refresh } = useSession();
  const current = session?.user?.id === user.id;
  const name = accountName(user);
  async function save() {
    if (!validStation(assigned)) {
      setError(
        "Provide a ship, department, and watch station, with 1–32 exact command IDs and department or watch profiles."
      );
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await accountRequest<{ user: AccountUser }>(`/api/v1/users/${encodeURIComponent(user.id)}`, {
        method: "PATCH",
        body: JSON.stringify({
          ...(stationChanged ? { stationAssignment: assigned } : {}),
        }),
      });
      setMessage("Station assignment updated.");
      await client.invalidateQueries({ queryKey: ["account-users"] });
      if (current) {
        await refresh();
      }
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Access could not be updated. Please retry."
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <form
      className="card border border-base-300 bg-base-100 p-5 gap-4"
      aria-label={`Access for ${name}`}
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="font-semibold">
            {name}
            {current ? " (you)" : ""}
          </h2>
          <p className="text-sm text-bc-muted break-all">{user.email || "No email supplied"}</p>
          <p className="text-xs font-mono break-all mt-1">User ID: {user.id}</p>
          <p className="text-xs text-bc-muted mt-2">
            Last sign-in: {accountTime(user.lastLoginAt)}
          </p>
        </div>
        <span className={`badge ${user.active ? "badge-success" : "badge-ghost"}`}>
          {user.active ? "Active" : "Suspended"}
        </span>
      </div>
      <fieldset disabled={saving} className="flex flex-wrap items-end gap-4">
        <p>
          Permission level:{" "}
          <span aria-label={`Permission level for ${name}`}>{roleLabel(user.role)}</span>
        </p>
        <button className="btn btn-primary" type="submit" disabled={saving || !stationChanged}>
          {saving ? "Saving…" : "Save station assignment"}
        </button>
      </fieldset>
      <StationAssignmentEditor
        value={assigned}
        name={name}
        disabled={saving}
        onChange={(value) => {
          setStation(value);
          setMessage("");
          setError("");
        }}
      />
      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
