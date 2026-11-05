import { LuMoon, LuSun, LuSunset } from "@defense-unicorns/ark-ui";
import { isLightTheme, useAppTheme, viceThemeName } from "../theme";
import { AppButton } from "./ui";

/** Single click toggles light/dark; double click or Shift+Enter reveals Vice. */
export function ThemeControl() {
  const { theme, style, selectTheme, toggleMode } = useAppTheme();
  const isLight = isLightTheme(theme);
  const label =
    theme === viceThemeName
      ? "Vice"
      : style === "windows"
        ? isLight
          ? "Windows Light"
          : "Windows Dark"
        : isLight
          ? "Haze Gray"
          : "Maritime Dark";
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
        onClick={toggleMode}
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
