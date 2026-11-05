import { LuMoon, LuSun, LuSunset } from "@defense-unicorns/ark-ui";
import { darkThemeName, themeName, useAppTheme, viceThemeName } from "../theme";
import { AppButton } from "./ui";

/** Single click toggles light/dark; double click or Shift+Enter reveals Vice. */
export function ThemeControl() {
  const { theme, selectTheme } = useAppTheme();
  const isLight = theme === themeName;
  const label = isLight ? "Haze Gray" : theme === viceThemeName ? "Vice" : "Maritime Dark";
  const Icon = isLight ? LuSun : theme === viceThemeName ? LuSunset : LuMoon;
  const nextLabel = isLight ? "dark" : "light";

  return (
    <div className="theme-control">
      <AppButton
        variant="ghost"
        size="sm"
        className="theme-toggle"
        aria-label={`Appearance: ${label}. Switch to ${nextLabel} mode`}
        title={`Switch to ${nextLabel} mode`}
        onClick={() => selectTheme(isLight ? darkThemeName : themeName)}
        // Native double-click dispatches two clicks first. Setting Vice here last
        // makes the gesture deterministic without delaying ordinary activation.
        onDoubleClick={() => selectTheme(viceThemeName)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && event.shiftKey) {
            event.preventDefault();
            if (!event.repeat) {
              selectTheme(viceThemeName);
            }
          }
        }}
      >
        <Icon aria-hidden="true" />
        <span>{isLight ? "Light" : theme === viceThemeName ? "Vice" : "Dark"}</span>
      </AppButton>
      <span className="sr-only" role="status" aria-live="polite">
        {label} appearance
      </span>
    </div>
  );
}
