import { NavLink } from "react-router-dom";
import { LuMenu } from "@defense-unicorns/ark-ui";
import { Popover } from "./popover";

export function NavigationMenu() {
  return (
    <Popover label="Navigation menu" trigger={<LuMenu aria-hidden="true" />}>
      {({ close }) => (
        <nav aria-label="Main navigation" className="navigation-menu">
          <NavLink to="/calendar" onClick={close}>
            Calendar
          </NavLink>
          <NavLink to="/messages" onClick={close}>
            Message Search
          </NavLink>
        </nav>
      )}
    </Popover>
  );
}
