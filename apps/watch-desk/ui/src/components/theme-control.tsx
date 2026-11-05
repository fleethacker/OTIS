import { TbDeviceTvOld, TbMoon, TbSun } from "react-icons/tb";
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
          ? "Navy and white"
          : "Maritime Dark";
  const Icon = isLight ? TbSun : theme === viceThemeName ? TbDeviceTvOld : TbMoon;
  const nextLabel = isLight ? "dark" : "light";

  return (
    <div className="theme-control">
      <AppButton
        variant="ghost"
        size="sm"
        className="theme-toggle"
        aria-label={`Appearance: ${label}. Switch to ${nextLabel} mode`}
        title={`Appearance: ${label}. Switch to ${nextLabel} mode`}
        // Handle the second click itself; some webviews omit the later dblclick.
        onClick={(event) => {
          if (event.detail >= 2) {
            selectTheme(viceThemeName);
          } else {
            toggleMode();
          }
        }}
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
      </AppButton>
      <span className="sr-only" role="status" aria-live="polite">
        {label} appearance
      </span>
    </div>
  );
}
