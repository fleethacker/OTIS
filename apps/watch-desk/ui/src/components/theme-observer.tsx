import { useAppTheme } from "../theme";

/** Keep browser preferences live while the authentication gate hides the app. */
export function ThemeObserver() {
  useAppTheme();
  return null;
}
