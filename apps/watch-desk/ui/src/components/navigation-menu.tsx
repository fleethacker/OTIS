import { NavLink, useLocation } from "react-router-dom";
import { calendarReturn } from "./calendar-links";
import { TbMenu2 } from "react-icons/tb";
import { Popover } from "./popover";
import { usePermission } from "./session";

export function NavigationMenu() {
  const location = useLocation();
  const returnTo =
    location.pathname === "/calendar"
      ? location.pathname + location.search
      : calendarReturn(new URLSearchParams(location.search).get("returnTo"));
  const manageUsers = usePermission("users:manage");
  return (
    <Popover label="Navigation menu" trigger={<TbMenu2 aria-hidden="true" />}>
      {({ close }) => (
        <nav aria-label="Main navigation" className="navigation-menu">
          <NavLink to="/shift" onClick={close}>
            Shift briefing
          </NavLink>
          <NavLink to="/calendar" onClick={close}>
            Calendar
          </NavLink>
          <NavLink to="/messages" onClick={close}>
            Message Search
          </NavLink>
          <NavLink to={`/watch-settings?${new URLSearchParams({ returnTo })}`} onClick={close}>
            Watch settings
          </NavLink>
          {manageUsers && (
            <NavLink to="/users" onClick={close}>
              User management
            </NavLink>
          )}
          <NavLink to="/about" onClick={close}>
            About OTIS
          </NavLink>
        </nav>
      )}
    </Popover>
  );
}
