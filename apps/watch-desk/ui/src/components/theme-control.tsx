import { TbDeviceTvOld, TbMoon, TbSun } from "react-icons/tb";
import { darkThemeName, themeName, useAppTheme, viceThemeName } from "../theme";
import { AppButton } from "./ui";

/** Single click toggles light/dark; double click or Shift+Enter reveals Vice. */
export function ThemeControl() {
  const { theme, selectTheme } = useAppTheme();
  const isLight = theme === themeName;
  const label = isLight ? "Haze Gray" : theme === viceThemeName ? "Vice" : "Maritime Dark";
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
        onClick={(event) => selectTheme(event.detail >= 2 ? viceThemeName : isLight ? darkThemeName : themeName)}
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
