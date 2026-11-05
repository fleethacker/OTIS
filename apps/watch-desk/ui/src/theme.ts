import { useSyncExternalStore } from "react";

export const themeName = "app";
export const darkThemeName = "app-dark";
export const viceThemeName = "app-vice";
export const windowsThemeName = "app-windows";
export const windowsDarkThemeName = "app-windows-dark";
export const THEME_STORAGE_KEY = "watch-desk.appearance";
export const STYLE_STORAGE_KEY = "watch-desk.appearance-style";
export type AppearanceStyle = "maritime" | "windows";
export type AppTheme =
  | typeof themeName
  | typeof darkThemeName
  | typeof viceThemeName
  | typeof windowsThemeName
  | typeof windowsDarkThemeName;
type ColorMode = "light" | "dark";
interface AppearanceState {
  preference: AppTheme | null;
  style: AppearanceStyle;
  system: ColorMode;
}

export function isAppTheme(value: unknown): value is AppTheme {
  return (
    value === themeName ||
    value === darkThemeName ||
    value === viceThemeName ||
    value === windowsThemeName ||
    value === windowsDarkThemeName
  );
}

export function isAppearanceStyle(value: unknown): value is AppearanceStyle {
  return value === "maritime" || value === "windows";
}

export function isLightTheme(theme: AppTheme) {
  return theme === themeName || theme === windowsThemeName;
}

function styleTheme(style: AppearanceStyle, mode: ColorMode): AppTheme {
  return style === "windows"
    ? mode === "light"
      ? windowsThemeName
      : windowsDarkThemeName
    : mode === "light"
      ? themeName
      : darkThemeName;
}

function themeStyle(theme: AppTheme): AppearanceStyle {
  return theme === windowsThemeName || theme === windowsDarkThemeName ? "windows" : "maritime";
}

function systemMode(): ColorMode {
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch {
    return "light";
  }
}

function defaultState(): AppearanceState {
  return { preference: null, style: "maritime", system: systemMode() };
}

function readSavedState(): AppearanceState | null {
  let preference: AppTheme | null = null;
  let style: AppearanceStyle = "maritime";
  try {
    const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    const savedStyle = window.localStorage.getItem(STYLE_STORAGE_KEY);
    preference = isAppTheme(savedTheme) ? savedTheme : null;
    style = isAppearanceStyle(savedStyle) ? savedStyle : "maritime";
  } catch {
    return null;
  }
  // Legacy app/app-dark values remain authoritative. Vice retains its base style.
  if (preference !== null && preference !== viceThemeName) {
    style = themeStyle(preference);
  }
  return { preference, style, system: systemMode() };
}

function resolvedTheme(state: AppearanceState) {
  return state.preference ?? styleTheme(state.style, state.system);
}

function applyPreference(state: AppearanceState) {
  if (state.preference === null && state.style === "maritime") {
    // Preserve the existing CSS system preference before an explicit selection.
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", resolvedTheme(state));
  }
}

let current: AppearanceState | undefined;
let memoryOnly = false;
const listeners = new Set<() => void>();
function getSnapshot() {
  current ??= readSavedState() ?? defaultState();
  return current;
}

function publish(next: AppearanceState) {
  const previous = current;
  applyPreference(next);
  if (
    previous?.preference === next.preference &&
    previous.style === next.style &&
    previous.system === next.system
  ) {
    return;
  }
  current = next;
  for (const listener of listeners) {
    listener();
  }
}

let removeListeners: (() => void) | undefined;
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    // A different tab may have changed preferences while no control was mounted.
    // Failed writes must not erase the current page's in-memory choice on remount.
    const saved = memoryOnly ? null : readSavedState();
    if (saved) {
      publish(saved);
    }
    let media: MediaQueryList | undefined;
    const onSystemChange = () => publish({ ...getSnapshot(), system: systemMode() });
    try {
      media = window.matchMedia("(prefers-color-scheme: dark)");
      media.addEventListener("change", onSystemChange);
    } catch {
      // System appearance detection is optional in constrained browsers.
    }
    const onStorage = (event: StorageEvent) => {
      if (
        event.key !== THEME_STORAGE_KEY &&
        event.key !== STYLE_STORAGE_KEY &&
        event.key !== null
      ) {
        return;
      }
      if (event.storageArea !== null) {
        try {
          if (event.storageArea !== window.localStorage) {
            return;
          }
        } catch {
          return;
        }
      }
      // Read both keys together: another tab may update them in the same turn.
      const saved = readSavedState();
      if (saved) {
        memoryOnly = false;
        publish(saved);
      }
    };
    window.addEventListener("storage", onStorage);
    removeListeners = () => {
      media?.removeEventListener("change", onSystemChange);
      window.removeEventListener("storage", onStorage);
    };
    onSystemChange();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      removeListeners?.();
      removeListeners = undefined;
    }
  };
}

/** Restore saved appearance before React mounts, including on the sign-in screen. */
export function initializeTheme() {
  memoryOnly = false;
  publish(readSavedState() ?? defaultState());
}

function saveAppearance(state: AppearanceState) {
  try {
    if (state.preference === null) {
      window.localStorage.removeItem(THEME_STORAGE_KEY);
    } else {
      window.localStorage.setItem(THEME_STORAGE_KEY, state.preference);
    }
    window.localStorage.setItem(STYLE_STORAGE_KEY, state.style);
    memoryOnly = false;
  } catch {
    // Publish regardless: mounted controls share the choice even without storage.
    memoryOnly = true;
  }
  publish(state);
}

function selectTheme(theme: AppTheme) {
  const state = getSnapshot();
  const style = theme === viceThemeName ? state.style : themeStyle(theme);
  saveAppearance({ ...state, preference: theme, style });
}

function selectStyle(style: AppearanceStyle) {
  const state = getSnapshot();
  const theme = resolvedTheme(state);
  // Choosing a base style leaves hidden Vice in light mode, like its header exit.
  const mode = theme === viceThemeName || isLightTheme(theme) ? "light" : "dark";
  saveAppearance({
    ...state,
    style,
    preference: state.preference === null ? null : styleTheme(style, mode),
  });
}

function toggleMode() {
  const state = getSnapshot();
  const theme = resolvedTheme(state);
  selectTheme(styleTheme(state.style, isLightTheme(theme) ? "dark" : "light"));
}

export function useAppTheme() {
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return { theme: resolvedTheme(state), style: state.style, selectTheme, selectStyle, toggleMode };
}
