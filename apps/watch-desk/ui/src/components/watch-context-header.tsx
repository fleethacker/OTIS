import { Link, useLocation } from "react-router-dom";
import { calendarReturn } from "./calendar-links";
import { useCommands } from "./command-roster";
import { ownShip, useSettings } from "./settings-data";

/** Own ship and operation from the shared Settings document. */
export function WatchContextHeader() {
  const { shared } = useSettings();
  const roster = useCommands();
  const location = useLocation();
  const returnTo = location.pathname === "/calendar" ? location.pathname + location.search :
    calendarReturn(new URLSearchParams(location.search).get("returnTo"));
  const href = `/settings?${new URLSearchParams({ returnTo })}`;
  const settings = shared?.settings;
  if (!settings) return <small>Watch context loading…</small>;
  const own = ownShip(settings);
  const ship = settings.shipName || (own && (roster.data?.commands.find((c) => c.id === own)?.name ?? own)) || "Own ship not set";
  return <small><Link to={href} title="Shared watch settings. An administrator can change them in Settings.">
    {ship} · {settings.operationName || "Operation not set"}{settings.groupCommand ? ` · ${settings.groupCommand}` : ""}
  </Link></small>;
}
