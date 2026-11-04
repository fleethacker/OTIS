import { Outlet } from "react-router-dom";
import { NavigationMenu } from "./navigation-menu";
import { UserMenu } from "./UserMenu";
import { Notifications } from "./notifications";
import { DisplayTimeProvider, useDisplayTime } from "./display-time";

export function AppLayout() {
  return (
    <DisplayTimeProvider>
      <DeskLayout />
    </DisplayTimeProvider>
  );
}
function DeskLayout() {
  const { label } = useDisplayTime();
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="desk-header">
        <div className="header-start">
          <NavigationMenu />
          <div className="wordmark">
            <span className="desk-mark" aria-hidden="true">
              W<span>/</span>D
            </span>
            <span>
              Watch Desk<small>Ship schedule workspace</small>
            </span>
          </div>
        </div>
        <div className="account">
          <Notifications />
          <UserMenu />
        </div>
      </header>
      <main id="main" tabIndex={-1}>
        <Outlet />
      </main>
      <footer className="desk-footer">
        <span>Watch Desk · Workspace preview</span>
        <span>Display: {label} · Source instants retained in UTC</span>
      </footer>
    </>
  );
}
