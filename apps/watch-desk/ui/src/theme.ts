import { useEffect, useState } from "react";

export const themeName = "app";
export const darkThemeName = "app-dark";
export const viceThemeName = "app-vice";
export const THEME_STORAGE_KEY = "watch-desk.appearance";
export type AppTheme = typeof themeName | typeof darkThemeName | typeof viceThemeName;

export function isAppTheme(value: unknown): value is AppTheme {
  return value === themeName || value === darkThemeName || value === viceThemeName;
}

function storedTheme(): AppTheme | null {
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isAppTheme(value) ? value : null;
  } catch {
    // Storage may be disabled. The control still works for this page session.
    return null;
  }
}

function systemTheme(): AppTheme {
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? darkThemeName : themeName;
  } catch {
    return themeName;
  }
}

function applyPreference(preference: AppTheme | null) {
  if (preference) {
    document.documentElement.setAttribute("data-theme", preference);
  } else {
    // Leave the CSS media query in charge until the user chooses an appearance.
    document.documentElement.removeAttribute("data-theme");
  }
}

/** Apply a saved selection before React mounts, including on the sign-in screen. */
export function initializeTheme() {
  applyPreference(storedTheme());
}

export function useAppTheme() {
  const [preference, setPreference] = useState<AppTheme | null>(storedTheme);
  const [system, setSystem] = useState<AppTheme>(systemTheme);

  useEffect(() => {
    let media: MediaQueryList | undefined;
    const onSystemChange = () => setSystem(systemTheme());
    try {
      media = window.matchMedia("(prefers-color-scheme: dark)");
      media.addEventListener("change", onSystemChange);
      onSystemChange();
    } catch {
      // System preference detection is optional in constrained browsers.
    }
    const onStorage = (event: StorageEvent) => {
      if (event.key !== THEME_STORAGE_KEY && event.key !== null) {
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
      const next = isAppTheme(event.newValue) ? event.newValue : null;
      setPreference(next);
      applyPreference(next);
      onSystemChange();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      media?.removeEventListener("change", onSystemChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  useEffect(() => applyPreference(preference), [preference]);

  function selectTheme(next: AppTheme) {
    setPreference(next);
    applyPreference(next);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Retain the in-memory selection even when it cannot be persisted.
    }
  }

  return { theme: preference ?? system, selectTheme };
}
