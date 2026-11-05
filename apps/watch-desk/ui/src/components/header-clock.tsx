import { useEffect, useMemo, useState } from "react";
import { useDisplayTime } from "./display-time";

export function HeaderClock() {
  const { zone } = useDisplayTime();
  const [now, setNow] = useState(() => Date.now());
  const formatter = useMemo(
    () =>
      new Intl.DateTimeFormat("en-GB", {
        timeZone: zone,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
        timeZoneName: "short",
      }),
    [zone]
  );
  useEffect(() => {
    // Read the clock each tick, rather than adding seconds and accumulating drift.
    const update = () => setNow(Date.now());
    const timer = window.setInterval(update, 1000);
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);
  return (
    <time
      className="header-clock"
      role="timer"
      aria-label="Current time"
      aria-live="off"
      dateTime={new Date(now).toISOString()}
    >
      {formatter.format(now)}
    </time>
  );
}
