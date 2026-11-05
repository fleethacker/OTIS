import { createContext, createElement, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigationType, useSearchParams } from "react-router-dom";
import { CalendarPreferencesContext, DEFAULT_CALENDAR_PREFERENCES, type CalendarPreferences } from "./calendar-preferences";
import { isoBoundary } from "./watch-boundary";

type CalendarParamsValue = readonly [URLSearchParams, (change: (next: URLSearchParams) => void, replace?: boolean) => void];
const CalendarParamsContext = createContext<CalendarParamsValue | null>(null);

/** Restore presentation/filter preferences only. Dates and searches belong to this visit. */
export function initialCalendarParams(search: string, saved: CalendarPreferences): URLSearchParams {
  const next = new URLSearchParams(search);
  if (!next.has("view")) next.set("view", saved.view);
  if (!next.has("interval")) next.set("interval", saved.interval);
  if (!next.has("shipLayout") && saved.shipLayout !== "combined") next.set("shipLayout", saved.shipLayout);
  if (!next.has("layout") && saved.layout !== "fit") next.set("layout", saved.layout);
  if (!next.has("ships") && saved.ships !== null) next.set("ships", saved.ships);
  if (!next.has("since") && (saved.turnoverChoice !== "auto" || saved.turnoverOpen)) {
    next.set("since", `${saved.turnoverOpen ? "" : "closed:"}${saved.turnoverChoice}`);
  }
  return next;
}

export function calendarPreferencesFromParams(params: URLSearchParams, current: CalendarPreferences): CalendarPreferences {
  const since = params.get("since");
  const closed = since?.startsWith("closed:") === true;
  const choice = closed ? since!.slice(7) : since;
  return {
    ...current,
    view: params.get("view") === "week" ? "week" : params.get("view") === "month" ? "month" : "day",
    interval: params.get("interval") === "30" ? "30" : "60",
    shipLayout: params.get("shipLayout") === "side" ? "side" : "combined",
    layout: params.get("layout") === "expanded" ? "expanded" : "fit",
    ships: params.get("ships"),
    ...(choice !== null && (choice === "auto" || isoBoundary(choice) !== undefined)
      ? { turnoverChoice: choice, turnoverOpen: !closed } : {}),
  };
}

/** One synchronous URL writer for search, ship controls and watch disclosures. */
export function CalendarParamsProvider({ children }: { children: ReactNode }) {
  const preferences = useContext(CalendarPreferencesContext);
  const location = useLocation();
  const initial = useRef<URLSearchParams | null>(null);
  initial.current ??= initialCalendarParams(location.search, preferences?.preferences ?? DEFAULT_CALENDAR_PREFERENCES);
  const value = useLocalCalendarParams(initial.current, true);
  const update = preferences?.update;
  useEffect(() => {
    update?.((current) => calendarPreferencesFromParams(value[0], current));
  }, [value[0], update]);
  return createElement(CalendarParamsContext.Provider, { value }, children);
}

/** Keep controlled inputs synchronous while Router commits navigation in a transition. */
export function useCalendarParams() {
  const shared = useContext(CalendarParamsContext);
  const local = useLocalCalendarParams(undefined, false, shared !== null);
  return shared ?? local;
}

function useLocalCalendarParams(initial?: URLSearchParams, canonicalize = false, disabled = false): CalendarParamsValue {
  const [routed, navigate] = useSearchParams();
  const location = useLocation();
  const navigationType = useNavigationType();
  const [params, setParams] = useState(initial ?? routed);
  const latest = useRef(params);
  const pending = useRef<string | null>(null);
  const landing = useRef({ key: location.key, search: location.search });
  const restoring = useRef(canonicalize && params.toString() !== routed.toString());
  const restoreStarted = useRef(false);
  useLayoutEffect(() => {
    if (disabled) return;
    if (restoring.current && location.key === landing.current.key && location.search === landing.current.search) {
      // Canonicalize once, before interaction. Strict Mode may replay this effect.
      if (!restoreStarted.current) {
        restoreStarted.current = true;
        pending.current = latest.current.toString();
        void navigate(latest.current, { replace: true });
      }
      return;
    }
    restoring.current = false;
    const incoming = new URLSearchParams(location.search);
    // Ignore an older self-authored transition, but always honor Back/Forward.
    if (navigationType !== "POP" && pending.current !== null && incoming.toString() !== pending.current) return;
    pending.current = null;
    latest.current = incoming;
    setParams(incoming);
  }, [location.key, location.search, navigationType, disabled, navigate]);
  function update(change: (next: URLSearchParams) => void, replace = false) {
    const next = new URLSearchParams(latest.current);
    change(next);
    latest.current = next;
    pending.current = next.toString();
    setParams(next);
    void navigate(next, { replace });
  }
  return [params, update] as const;
}
