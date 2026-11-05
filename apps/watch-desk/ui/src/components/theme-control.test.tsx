import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import {
  darkThemeName,
  initializeTheme,
  THEME_STORAGE_KEY,
  themeName,
  viceThemeName,
} from "../theme";
import { ThemeControl } from "./theme-control";

let dark = false;
let media: MediaQueryList;
let restoreMedia: () => void;

beforeEach(() => {
  localStorage.removeItem(THEME_STORAGE_KEY);
  document.documentElement.removeAttribute("data-theme");
  dark = false;
  media = Object.assign(new EventTarget(), {
    media: "(prefers-color-scheme: dark)",
    onchange: null,
  }) as MediaQueryList;
  Object.defineProperty(media, "matches", { get: () => dark });
  const mock = spyOn(window, "matchMedia").mockImplementation(() => media);
  restoreMedia = () => mock.mockRestore();
});

afterEach(() => {
  cleanup();
  restoreMedia();
  localStorage.removeItem(THEME_STORAGE_KEY);
  document.documentElement.removeAttribute("data-theme");
});

test("appearance follows system changes until the user selects a persistent mode", () => {
  const view = render(<ThemeControl />);
  expect(view.getByRole("button", { name: /Appearance: Haze Gray/ })).toBeInTheDocument();
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
  expect(view.getByRole("status")).toHaveTextContent("Haze Gray appearance");
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

test("a second pointer click selects Vice even when the webview omits dblclick", () => {
  const view = render(<ThemeControl />);
  const button = view.getByRole("button");
  fireEvent.click(button, { detail: 1 });
  expect(document.documentElement.getAttribute("data-theme")).toBe(darkThemeName);
  fireEvent.click(button, { detail: 2 });
  expect(document.documentElement.getAttribute("data-theme")).toBe(viceThemeName);
  expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe(viceThemeName);

  // Keyboard activation is a separate single activation, even after a double-click.
  fireEvent.click(button, { detail: 0 });
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
    window.dispatchEvent(
      new StorageEvent("storage", { key: THEME_STORAGE_KEY, newValue: viceThemeName })
    );
  });
  expect(view.getByRole("status")).toHaveTextContent("Vice appearance");
  act(() => {
    dark = true;
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
  expect(view.getByRole("status")).toHaveTextContent("Haze Gray appearance");
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
    expect(view.getByRole("status")).toHaveTextContent("Haze Gray appearance");
    fireEvent.click(view.getByRole("button"));
    expect(document.documentElement.getAttribute("data-theme")).toBe(darkThemeName);
  } finally {
    unavailable.mockRestore();
  }
});
