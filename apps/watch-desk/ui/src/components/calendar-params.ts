import { useLayoutEffect, useRef, useState } from "react";
import { NavigationType, useLocation, useNavigationType, useSearchParams } from "react-router-dom";

/** Keep controlled inputs synchronous while Router commits navigation in a transition. */
export function useCalendarParams() {
  const [routed, navigate] = useSearchParams();
  const location = useLocation();
  const navigationType = useNavigationType();
  const [params, setParams] = useState(routed);
  const latest = useRef(routed);
  const pending = useRef<string | null>(null);
  useLayoutEffect(() => {
    const incoming = new URLSearchParams(location.search);
    // Ignore an older self-authored transition, but always honor Back/Forward.
    if (
      navigationType !== NavigationType.Pop &&
      pending.current !== null &&
      incoming.toString() !== pending.current
    ) {
      return;
    }
    pending.current = null;
    latest.current = incoming;
    setParams(incoming);
  }, [location.key, location.search, navigationType]);
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
