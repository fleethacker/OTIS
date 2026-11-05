import { Link, Outlet } from "react-router-dom";
import otisIcon from "../assets/otis/otis-icon.webp";
import { WatchContextHeader } from "./watch-context-header";
import { StationAssignmentNotice } from "./station-assignment";
import { HeaderClock } from "./header-clock";
import { NavigationMenu } from "./navigation-menu";
import { UserMenu } from "./UserMenu";
import { SettingsButton } from "./settings-button";
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
            <Link to="/calendar" aria-label="OTIS calendar">
              <img className="otis-mark" src={otisIcon} width={44} height={44} alt="" />
            </Link>
            <span>
              <span className="wordmark-title">
                OTIS<small>Keeping the Watch</small>
              </span>
              <WatchContextHeader />
            </span>
          </div>
        </div>
        <HeaderClock />
        <div className="account">
          <Notifications />
          <UserMenu />
          <SettingsButton />
        </div>
      </header>
      <main id="main" tabIndex={-1}>
        <StationAssignmentNotice />
        <Outlet />
      </main>
      <footer className="desk-footer">
        <span>
          OTIS · <Link to="/about">About OTIS</Link>
        </span>
        <span>Display: {label} · Source instants retained in UTC</span>
      </footer>
    </>
  );
}
