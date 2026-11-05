import {
  createContext, useCallback, useContext, useEffect, useRef, useState,
  type Dispatch, type ReactNode, type SetStateAction,
} from "react";
import {
  calendarPreferenceStorage, DEFAULT_CALENDAR_PREFERENCES, sanitizeCalendarPreferences,
  type CalendarPreferences, type CalendarPreferenceStorage,
} from "./calendar-preference-storage";

export { DEFAULT_CALENDAR_PREFERENCES, type CalendarPreferences } from "./calendar-preference-storage";

/** Opaque, server-verified owner/role scope. Never derive this from a display name. */
export const BrowserPreferenceScope = createContext<string | null>(null);
export const CalendarPreferencesContext = createContext<{
  preferences: CalendarPreferences;
  update: (change: (current: CalendarPreferences) => CalendarPreferences) => void;
} | null>(null);

export function CalendarPreferencesProvider({ scope, storage = calendarPreferenceStorage, defaultView = "day", children }: {
  scope?: string | null;
  storage?: CalendarPreferenceStorage;
  defaultView?: CalendarPreferences["view"];
  children: ReactNode;
}) {
  // A keyed child prevents late reads or writes from crossing account boundaries.
  return <PreferenceSession key={scope ?? "ephemeral"} scope={scope} storage={storage} defaultView={defaultView}>{children}</PreferenceSession>;
}

function PreferenceSession({ scope, storage, defaultView, children }: {
  scope?: string | null;
  storage: CalendarPreferenceStorage;
  defaultView: CalendarPreferences["view"];
  children: ReactNode;
}) {
  const [preferences, setPreferences] = useState<CalendarPreferences>(() => ({ ...DEFAULT_CALENDAR_PREFERENCES, view: defaultView }));
  const [ready, setReady] = useState(!scope);
  const latest = useRef(preferences);
  const mounted = useRef(true);
  useEffect(() => {
    let active = true;
    mounted.current = true;
    if (scope) {
      void storage.read(scope).catch(() => undefined).then((saved) => {
        if (!active) return;
        latest.current = sanitizeCalendarPreferences(saved ?? { view: defaultView });
        setPreferences(latest.current);
        setReady(true);
      });
    }
    return () => { active = false; mounted.current = false; };
  }, [scope, storage, defaultView]);

  const update = useCallback((change: (current: CalendarPreferences) => CalendarPreferences) => {
    if (!mounted.current) return;
    const next = sanitizeCalendarPreferences(change(latest.current));
    if (JSON.stringify(next) === JSON.stringify(latest.current)) return;
    latest.current = next;
    if (mounted.current) setPreferences(next);
    // Storage serializes writes. Failure leaves this visit fully usable in memory.
    if (scope) void storage.write(scope, next).catch(() => {});
  }, [scope, storage]);

  if (!ready) return <p role="status">Loading calendar…</p>;
  return <CalendarPreferencesContext.Provider value={{ preferences, update }}>{children}</CalendarPreferencesContext.Provider>;
}

export function useCalendarPreference<K extends keyof CalendarPreferences>(key: K):
  [CalendarPreferences[K], Dispatch<SetStateAction<CalendarPreferences[K]>>] {
  const context = useContext(CalendarPreferencesContext);
  const update = context?.update;
  const [local, setLocal] = useState<CalendarPreferences[K]>(DEFAULT_CALENDAR_PREFERENCES[key]);
  const setValue = useCallback<Dispatch<SetStateAction<CalendarPreferences[K]>>>((value) => {
    if (update) {
      update((current) => ({ ...current, [key]: typeof value === "function" ? value(current[key]) : value }));
    } else {
      setLocal(value);
    }
  }, [key, update]);
  return [context ? context.preferences[key] : local, setValue];
}
