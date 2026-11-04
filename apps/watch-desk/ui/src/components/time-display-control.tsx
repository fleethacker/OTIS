import { useDisplayTime, deviceZone } from "./display-time";

export function TimeDisplayControl() {
  const { mode, setMode, label } = useDisplayTime();
  return (
    <div className="time-display-control">
      <div className="join" role="group" aria-label="Display time zone">
        <button
          className="btn btn-xs join-item"
          aria-pressed={mode === "utc"}
          onClick={() => setMode("utc")}
        >
          Zulu / UTC
        </button>
        <button
          className="btn btn-xs join-item"
          aria-pressed={mode === "local"}
          onClick={() => setMode("local")}
        >
          Local
        </button>
      </div>
      <small>{mode === "local" ? label : `Device: ${deviceZone()}`}</small>
    </div>
  );
}
