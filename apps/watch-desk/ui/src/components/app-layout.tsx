import { SettingsProvider } from "./SettingsProvider";
import { Link, Outlet } from "react-router-dom";
import otisIcon from "../assets/otis/otis-icon.webp";
import { HeaderClock } from "./header-clock";
import { WatchContextHeader } from "./watch-context-header";
import { NavigationMenu } from "./navigation-menu";
import { UserMenu } from "./UserMenu";
import { SettingsButton } from "./settings-button";
import { Notifications } from "./notifications";
import { ThemeControl } from "./theme-control";
import { DisplayTimeProvider, useDisplayTime } from "./display-time";

export function AppLayout() {
  return (
    <SettingsProvider>
      <DisplayTimeProvider>
        <DeskLayout />
      </DisplayTimeProvider>
    </SettingsProvider>
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
          <Link className="wordmark" to="/calendar" aria-label="OTIS calendar">
            <img className="otis-mark" src={otisIcon} width={44} height={44} alt="" />
            <span>
              OTIS<small>Keeping the Watch</small>
            </span>
          </Link>
        </div>
        <HeaderClock />
        <div className="account">
          <Notifications />
          <UserMenu />
          <SettingsButton />
          <ThemeControl />
        </div>
      </header>
      <main id="main" tabIndex={-1}>
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
