import { Link } from "react-router-dom";
import { useSession, type StationAssignment } from "./session";

export function StationSummary({
  assignment,
  required = false,
}: {
  assignment: StationAssignment | null | undefined;
  required?: boolean;
}) {
  if (assignment === null || assignment === undefined) {
    return (
      <section className="card border border-base-300 p-5 gap-2">
        <h2 className="text-lg font-semibold">Assigned station</h2>
        <p>No station has been assigned to your account.</p>
        {required && (
          <p role="alert">
            An administrator must assign your ship, department, and watch station before messages
            can be shown.
          </p>
        )}
      </section>
    );
  }
  return (
    <section className="card border border-base-300 p-5 gap-3">
      <h2 className="text-lg font-semibold">Assigned station</h2>
      <dl className="structured-fields">
        <div>
          <dt>Ship / command</dt>
          <dd>{assignment.shipName}</dd>
        </div>
        <div>
          <dt>Department</dt>
          <dd>{assignment.department}</dd>
        </div>
        <div>
          <dt>Watch station</dt>
          <dd>{assignment.watchStation}</dd>
        </div>
        <div>
          <dt>Command IDs</dt>
          <dd>{assignment.commandIds.join(", ")}</dd>
        </div>
      </dl>
      <p className="text-sm text-bc-muted">
        {assignment.source === "oidc"
          ? "Assigned from your sign-in profile."
          : "Assigned by an administrator."}{" "}
        Personal preferences can narrow this station's messages.
      </p>
    </section>
  );
}
export function StationAssignmentNotice() {
  const { session } = useSession();
  if (
    session?.stationAssignmentRequired !== true ||
    (session.user?.stationAssignment !== null && session.user?.stationAssignment !== undefined)
  ) {
    return null;
  }
  return (
    <div className="alert m-4" role="alert">
      Your station has not been assigned. Ask an administrator to set your ship, department, and
      watch station.{" "}
      <Link className="link" to="/account">
        View account
      </Link>
    </div>
  );
}
