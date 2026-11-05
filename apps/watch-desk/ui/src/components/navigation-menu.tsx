import { NavLink } from "react-router-dom";
import { TbMenu2 } from "react-icons/tb";
import { Popover } from "./popover";

export function NavigationMenu() {
  return (
    <Popover label="Navigation menu" trigger={<TbMenu2 aria-hidden="true" />}>
      {({ close }) => (
        <nav aria-label="Main navigation" className="navigation-menu">
          <NavLink to="/calendar" onClick={close}>
            Calendar
          </NavLink>
          <NavLink to="/messages" onClick={close}>
            Message Search
          </NavLink>
          <NavLink to="/about" onClick={close}>
            About OTIS
          </NavLink>
        </nav>
      )}
    </Popover>
  );
}
