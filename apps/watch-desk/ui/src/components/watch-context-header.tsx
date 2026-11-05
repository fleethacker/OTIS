import { Link, useLocation } from "react-router-dom";
import { calendarReturn } from "./calendar-links";
import { useCommands } from "./command-roster";
import { useWatchContext } from "./watch-context";

export function WatchContextHeader() {
  const context = useWatchContext();
  const roster = useCommands();
  const location = useLocation();
  const returnTo =
    location.pathname === "/calendar"
      ? location.pathname + location.search
      : calendarReturn(new URLSearchParams(location.search).get("returnTo"));
  const href = `/watch-settings?${new URLSearchParams({ returnTo })}`;
  if (context.isError) {
    return (
      <small>
        <Link to={href}>Watch context unavailable · Settings</Link>
      </small>
    );
  }
  const data = context.data;
  if (!data) {
    return <small>Watch context loading…</small>;
  }
  const rosterName = roster.data?.commands.find((c) => c.id === data.context.ownShipId)?.name;
  const ship =
    data.context.ownShipId !== ""
      ? data.context.shipName !== ""
        ? data.context.shipName
        : (rosterName ?? data.context.ownShipId)
      : "Own ship not set";
  const defaults = data.demoRoster === true ? "Demo defaults" : "Defaults";
  return (
    <small>
      <Link
        to={href}
        title={`App-wide context; provenance and citations in Settings. ${(data.updatedBy ?? "") !== "" ? `Last changed by ${data.updatedBy}` : `${defaults}: ${data.defaultsSource}`}`}
      >
        {ship} · {data.context.operationName || "Operation not set"} ·{" "}
        {(data.updatedBy ?? "") !== "" ? "Context" : defaults}
      </Link>
    </small>
  );
}
