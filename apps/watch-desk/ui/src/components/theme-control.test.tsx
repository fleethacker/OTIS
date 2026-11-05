import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import {
  darkThemeName,
  initializeTheme,
  THEME_STORAGE_KEY,
  STYLE_STORAGE_KEY,
  themeName,
  viceThemeName,
  windowsThemeName,
  windowsDarkThemeName,
} from "../theme";
import { ThemeControl } from "./theme-control";
import { ThemeObserver } from "./theme-observer";
import { AppearancePreferences } from "./appearance-preferences";

let dark = false;
let media: MediaQueryList;
let restoreMedia: () => void;

beforeEach(() => {
  localStorage.removeItem(THEME_STORAGE_KEY);
  localStorage.removeItem(STYLE_STORAGE_KEY);
  document.documentElement.removeAttribute("data-theme");
  dark = false;
  media = Object.assign(new EventTarget(), {
    media: "(prefers-color-scheme: dark)",
    onchange: null,
  }) as MediaQueryList;
  Object.defineProperty(media, "matches", { get: () => dark });
  const mock = spyOn(window, "matchMedia").mockImplementation(() => media);
  restoreMedia = () => mock.mockRestore();
  initializeTheme();
});

afterEach(() => {
  cleanup();
  restoreMedia();
  localStorage.removeItem(THEME_STORAGE_KEY);
  localStorage.removeItem(STYLE_STORAGE_KEY);
  initializeTheme();
  document.documentElement.removeAttribute("data-theme");
});

test("appearance follows system changes until the user selects a persistent mode", () => {
  const view = render(<ThemeControl />);
  expect(view.getByRole("button", { name: /Appearance: Navy and white/ })).toBeInTheDocument();
  expect(document.documentElement.hasAttribute("data-theme")).toBe(false);

  act(() => {
    dark = true;
    media.dispatchEvent(new Event("change"));
  });
  expect(view.getByRole("button", { name: /Appearance: Maritime Dark/ })).toBeInTheDocument();
  fireEvent.click(view.getByRole("button"));
  expect(document.documentElement.getAttribute("data-theme")).toBe(themeName);
  expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe(themeName);

  act(() => media.dispatchEvent(new Event("change")));
  expect(view.getByRole("status")).toHaveTextContent("Navy and white appearance");
});

test("saved appearance initializes before mount and survives remount", () => {
  localStorage.setItem(THEME_STORAGE_KEY, darkThemeName);
  initializeTheme();
  expect(document.documentElement.getAttribute("data-theme")).toBe(darkThemeName);
  const first = render(<ThemeControl />);
  expect(first.getByRole("button", { name: /Switch to light mode/ })).toBeInTheDocument();
  first.unmount();
  expect(render(<ThemeControl />).getByRole("status")).toHaveTextContent(
    "Maritime Dark appearance"
  );
});

test("native click, click, double-click sequence selects Vice and ordinary click exits it", () => {
  const view = render(<ThemeControl />);
  const button = view.getByRole("button");
  fireEvent.click(button, { detail: 1 });
  fireEvent.click(button, { detail: 2 });
  fireEvent.doubleClick(button);
  expect(document.documentElement.getAttribute("data-theme")).toBe(viceThemeName);
  expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe(viceThemeName);
  expect(view.getByRole("status")).toHaveTextContent("Vice appearance");

  fireEvent.click(button);
  expect(document.documentElement.getAttribute("data-theme")).toBe(themeName);
});

test("Shift+Enter provides keyboard access to Vice without a subsequent native click", () => {
  const view = render(<ThemeControl />);
  const button = view.getByRole("button");
  button.focus();
  expect(fireEvent.keyDown(button, { key: "Enter", shiftKey: true })).toBe(false);
  expect(document.documentElement.getAttribute("data-theme")).toBe(viceThemeName);
  expect(button).toHaveFocus();
});

test("cross-tab selections and clearing preferences update the mounted control", () => {
  const view = render(<ThemeControl />);
  act(() => {
    localStorage.setItem(THEME_STORAGE_KEY, viceThemeName);
    window.dispatchEvent(
      new StorageEvent("storage", { key: THEME_STORAGE_KEY, newValue: viceThemeName })
    );
  });
  expect(view.getByRole("status")).toHaveTextContent("Vice appearance");
  act(() => {
    dark = true;
    localStorage.removeItem(THEME_STORAGE_KEY);
    localStorage.removeItem(STYLE_STORAGE_KEY);
    window.dispatchEvent(new StorageEvent("storage", { key: null, newValue: null }));
  });
  expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  expect(view.getByRole("status")).toHaveTextContent("Maritime Dark appearance");
});

test("malformed preferences return to the system theme", () => {
  localStorage.setItem(THEME_STORAGE_KEY, "unknown-theme");
  dark = true;
  initializeTheme();
  const view = render(<ThemeControl />);
  expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  expect(view.getByRole("status")).toHaveTextContent("Maritime Dark appearance");
});

test("unrelated session-storage events cannot change the selected appearance", () => {
  const view = render(<ThemeControl />);
  act(() => {
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: THEME_STORAGE_KEY,
        newValue: viceThemeName,
        storageArea: window.sessionStorage,
      })
    );
  });
  expect(view.getByRole("status")).toHaveTextContent("Navy and white appearance");
});

test("blocked storage does not prevent switching appearance", () => {
  const reads = spyOn(window.localStorage, "getItem").mockImplementation(() => {
    throw new DOMException("Storage disabled", "SecurityError");
  });
  const writes = spyOn(window.localStorage, "setItem").mockImplementation(() => {
    throw new DOMException("Storage disabled", "SecurityError");
  });
  try {
    initializeTheme();
    const view = render(<ThemeControl />);
    fireEvent.click(view.getByRole("button"));
    expect(document.documentElement.getAttribute("data-theme")).toBe(darkThemeName);
    expect(view.getByRole("status")).toHaveTextContent("Maritime Dark appearance");
  } finally {
    reads.mockRestore();
    writes.mockRestore();
  }
});

test("unavailable system preference APIs fall back to a usable light control", () => {
  const unavailable = spyOn(window, "matchMedia").mockImplementation(() => {
    throw new Error("Media queries unavailable");
  });
  try {
    const view = render(<ThemeControl />);
    expect(view.getByRole("status")).toHaveTextContent("Navy and white appearance");
    fireEvent.click(view.getByRole("button"));
    expect(document.documentElement.getAttribute("data-theme")).toBe(darkThemeName);
  } finally {
    unavailable.mockRestore();
  }
});

function appearanceControls() {
  return (
    <>
      <ThemeControl />
      <AppearancePreferences />
    </>
  );
}

test("Windows follows system changes before the authenticated controls are mounted", () => {
  localStorage.setItem(STYLE_STORAGE_KEY, "windows");
  initializeTheme();
  render(<ThemeObserver />);
  expect(document.documentElement.getAttribute("data-theme")).toBe(windowsThemeName);
  act(() => {
    dark = true;
    media.dispatchEvent(new Event("change"));
  });
  expect(document.documentElement.getAttribute("data-theme")).toBe(windowsDarkThemeName);
});

test("style selection synchronizes the mounted header and preserves dark mode", () => {
  const view = render(appearanceControls());
  const style = view.getByRole("combobox", { name: "Interface style (this browser)" });
  fireEvent.click(view.getByRole("button"));
  fireEvent.change(style, { target: { value: "windows" } });
  expect(view.getByRole("status")).toHaveTextContent("Windows Dark appearance");
  expect(document.documentElement.getAttribute("data-theme")).toBe(windowsDarkThemeName);
  expect(localStorage.getItem(STYLE_STORAGE_KEY)).toBe("windows");
  fireEvent.click(view.getByRole("button"));
  expect(document.documentElement.getAttribute("data-theme")).toBe(windowsThemeName);
  fireEvent.change(style, { target: { value: "maritime" } });
  expect(view.getByRole("status")).toHaveTextContent("Navy and white appearance");
});

test("changing only style retains live system appearance until a mode is explicitly chosen", () => {
  const view = render(appearanceControls());
  fireEvent.change(view.getByRole("combobox"), { target: { value: "windows" } });
  expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  expect(document.documentElement.getAttribute("data-theme")).toBe(windowsThemeName);
  act(() => {
    dark = true;
    media.dispatchEvent(new Event("change"));
  });
  expect(view.getByRole("status")).toHaveTextContent("Windows Dark appearance");
  fireEvent.click(view.getByRole("button"));
  expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe(windowsThemeName);
  act(() => media.dispatchEvent(new Event("change")));
  expect(view.getByRole("status")).toHaveTextContent("Windows Light appearance");
});

test("Windows survives hidden Vice, reload, and its ordinary click exit", () => {
  const first = render(appearanceControls());
  fireEvent.change(first.getByRole("combobox"), { target: { value: "windows" } });
  const button = first.getByRole("button");
  fireEvent.click(button, { detail: 1 });
  fireEvent.click(button, { detail: 2 });
  fireEvent.doubleClick(button);
  expect(document.documentElement.getAttribute("data-theme")).toBe(viceThemeName);
  expect(localStorage.getItem(STYLE_STORAGE_KEY)).toBe("windows");
  first.unmount();

  initializeTheme();
  const restored = render(appearanceControls());
  expect(restored.getByRole("combobox")).toHaveValue("windows");
  expect(restored.getByRole("status")).toHaveTextContent("Vice appearance");
  fireEvent.click(restored.getByRole("button"));
  expect(document.documentElement.getAttribute("data-theme")).toBe(windowsThemeName);
});

test("choosing a style while Vice is active leaves Vice in that style's light mode", () => {
  const view = render(appearanceControls());
  fireEvent.keyDown(view.getByRole("button"), { key: "Enter", shiftKey: true });
  fireEvent.change(view.getByRole("combobox"), { target: { value: "windows" } });
  expect(view.getByRole("status")).toHaveTextContent("Windows Light appearance");
  expect(document.documentElement.getAttribute("data-theme")).toBe(windowsThemeName);
});

test("cross-tab style and theme changes update every mounted appearance control", () => {
  const view = render(appearanceControls());
  act(() => {
    localStorage.setItem(THEME_STORAGE_KEY, windowsDarkThemeName);
    localStorage.setItem(STYLE_STORAGE_KEY, "windows");
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: THEME_STORAGE_KEY,
        newValue: windowsDarkThemeName,
        storageArea: localStorage,
      })
    );
  });
  expect(view.getByRole("combobox")).toHaveValue("windows");
  expect(view.getByRole("status")).toHaveTextContent("Windows Dark appearance");
  act(() => {
    localStorage.setItem(THEME_STORAGE_KEY, viceThemeName);
    localStorage.setItem(STYLE_STORAGE_KEY, "maritime");
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: STYLE_STORAGE_KEY,
        newValue: "maritime",
        storageArea: localStorage,
      })
    );
  });
  expect(view.getByRole("combobox")).toHaveValue("maritime");
  fireEvent.click(view.getByRole("button"));
  expect(document.documentElement.getAttribute("data-theme")).toBe(themeName);
});

test("legacy saved themes infer Maritime even when an unrelated style value is present", () => {
  for (const legacy of [themeName, darkThemeName]) {
    localStorage.setItem(THEME_STORAGE_KEY, legacy);
    localStorage.setItem(STYLE_STORAGE_KEY, "windows");
    initializeTheme();
    const view = render(appearanceControls());
    expect(document.documentElement.getAttribute("data-theme")).toBe(legacy);
    expect(view.getByRole("combobox")).toHaveValue("maritime");
    view.unmount();
  }
  localStorage.setItem(THEME_STORAGE_KEY, viceThemeName);
  localStorage.setItem(STYLE_STORAGE_KEY, "invalid");
  initializeTheme();
  const view = render(appearanceControls());
  expect(view.getByRole("combobox")).toHaveValue("maritime");
  fireEvent.click(view.getByRole("button"));
  expect(document.documentElement.getAttribute("data-theme")).toBe(themeName);
});

test("blocked storage preserves shared appearance in memory across control remounts", () => {
  const reads = spyOn(window.localStorage, "getItem").mockImplementation(() => {
    throw new DOMException("Storage disabled", "SecurityError");
  });
  const writes = spyOn(window.localStorage, "setItem").mockImplementation(() => {
    throw new DOMException("Storage disabled", "SecurityError");
  });
  try {
    initializeTheme();
    const first = render(appearanceControls());
    fireEvent.change(first.getByRole("combobox"), { target: { value: "windows" } });
    expect(first.getByRole("status")).toHaveTextContent("Windows Light appearance");
    first.unmount();
    const restored = render(appearanceControls());
    expect(restored.getByRole("combobox")).toHaveValue("windows");
    fireEvent.click(restored.getByRole("button"));
    expect(restored.getByRole("status")).toHaveTextContent("Windows Dark appearance");
    expect(document.documentElement.getAttribute("data-theme")).toBe(windowsDarkThemeName);
  } finally {
    reads.mockRestore();
    writes.mockRestore();
  }
});

test("remount reads changes made in another tab while no appearance controls were mounted", () => {
  const first = render(appearanceControls());
  first.unmount();
  localStorage.setItem(THEME_STORAGE_KEY, windowsDarkThemeName);
  localStorage.setItem(STYLE_STORAGE_KEY, "windows");
  const next = render(appearanceControls());
  expect(next.getByRole("combobox")).toHaveValue("windows");
  expect(next.getByRole("status")).toHaveTextContent("Windows Dark appearance");
  expect(document.documentElement.getAttribute("data-theme")).toBe(windowsDarkThemeName);
});

test("readable but unwritable storage cannot erase a session-only style on remount", () => {
  localStorage.setItem(THEME_STORAGE_KEY, themeName);
  initializeTheme();
  const writes = spyOn(window.localStorage, "setItem").mockImplementation(() => {
    throw new DOMException("Storage quota exceeded", "QuotaExceededError");
  });
  try {
    const first = render(appearanceControls());
    fireEvent.change(first.getByRole("combobox"), { target: { value: "windows" } });
    first.unmount();
    const next = render(appearanceControls());
    expect(next.getByRole("combobox")).toHaveValue("windows");
    expect(next.getByRole("status")).toHaveTextContent("Windows Light appearance");
    expect(document.documentElement.getAttribute("data-theme")).toBe(windowsThemeName);
  } finally {
    writes.mockRestore();
  }
});
