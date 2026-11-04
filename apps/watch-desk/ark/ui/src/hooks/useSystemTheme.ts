import { useState, useEffect } from "react";

/**
 * Hook to detect and respond to system dark mode preference
 * Returns 'light' or 'dark' based on system preference
 *
 * @example
 * ```tsx
 * function App() {
 *   const systemTheme = useSystemTheme()
 *   return <Theme appearance={systemTheme}>...</Theme>
 * }
 * ```
 */
export function useSystemTheme(): "light" | "dark" {
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    if (typeof window !== "undefined") {
      return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    return "light";
  });

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

    const handleChange = (e: MediaQueryListEvent): void => {
      setTheme(e.matches ? "dark" : "light");
    };

    mediaQuery.addEventListener("change", handleChange);

    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  return theme;
}
