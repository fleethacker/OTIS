import { useSearchParams } from "react-router-dom";
import { Link } from "react-router-dom";
import { useQuery } from "@defense-unicorns/ark-ui";
import type { RouteMeta } from "../route-registry";
import { readSchedules } from "../gen/app/v1/source_data-SourceDataService_connectquery";
import { DayTimeline } from "../components/day-timeline";
import {
  geometry,
  instant,
  utcDate,
  monthBounds,
  moveMonth,
  weekBounds,
  type CalendarView,
} from "../components/calendar-time";
import { discover } from "../components/schedule-discovery";
import { messageHref } from "../components/calendar-links";
import { useDisplayTime, civilDate, civilHour } from "../components/display-time";
import moment from "moment-timezone";
import { useState } from "react";
import { readShips, shipOptions, shipColor, shipName } from "../components/ship-calendars";
import { ShipMarker } from "../components/ship-marker";

export const route: RouteMeta = { path: "/calendar", label: "Calendar", order: 0 };
function available(value: string | undefined, fallback: string) {
  return value === undefined || value.trim() === "" ? fallback : value;
}
export default function Calendar() {
  const { zone, mode, label, format: utc } = useDisplayTime();
  const [params, setParams] = useSearchParams();
  const today = civilDate(new Date(), zone);
  // A landing date is a selected civil date too: don't change it when switching
  // zones near midnight before the user has touched any URL-owned control.
  const [landingDate] = useState(today);
  const date = utcDate(params.get("date"), landingDate);
  const view: CalendarView =
    params.get("view") === "month" ? "month" : params.get("view") === "week" ? "week" : "day";
  const month = view === "month";
  const week = view === "week";
  const bounds = monthBounds(date, zone);
  const weekly = weekBounds(date, zone);
  const interval = params.get("interval") === "30" ? 30 : 60;
  const hours = (params.get("hours") ?? "0-24").split("-").map(Number);
  const validHours =
    hours.length === 2 &&
    hours.every(Number.isInteger) &&
    hours[0] >= 0 &&
    hours[1] <= 24 &&
    hours[0] < hours[1];
  const [startHour, endHour] = validHours ? hours : [0, 24];
  const midnight = civilHour(date, 0, zone);
  const from = month ? bounds.from : week ? weekly.from : civilHour(date, startHour, zone),
    to = month ? bounds.to : week ? weekly.to : civilHour(date, endHour, zone);
  const result = useQuery(readSchedules, {}, { retry: false });
  const messages = result.data?.messages ?? [];
  const query = params.get("q") ?? "";
  const ships = readShips(params.get("ships"));
  const options = shipOptions(messages);
  const stale = ships ? [...ships].filter((key) => !options.some(([id]) => id === key)) : [];
  const discovery = discover(messages, query, Date.now(), ships);
  const inPeriod = discovery.timed.some(({ event }) => geometry(event, from, to));
  const canonical = new URLSearchParams(params);
  canonical.set("date", date);
  canonical.set("view", view);
  canonical.set("interval", String(interval));
  canonical.set("hours", `${startHour}-${endHour}`);
  const returnTo = `/calendar?${canonical.toString()}`;
  function update(key: string, value: string) {
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        for (const [name, fallback] of canonical) {
          if (!next.has(name)) {
            next.set(name, fallback);
          }
        }
        next.set(key, value);
        return next;
      },
      { replace: key === "q" }
    );
  }
  function move(days: number) {
    update(
      "date",
      month
        ? moveMonth(date, days)
        : moment
            .tz(midnight, zone)
            .add(days * (week ? 7 : 1), "day")
            .format("YYYY-MM-DD")
    );
  }
  return (
    <div className={week ? "calendar-page-week" : undefined}>
      <div className="page-heading">
        <div>
          <h1>Calendar</h1>
          <p>Ship schedule · {label}</p>
        </div>
        <span className="view-label">{month ? "Month" : week ? "Week" : "Day"} view</span>
      </div>
      <section className="calendar-controls" aria-label="Calendar controls">
        <label className="schedule-search">
          Search schedule
          <input
            className="input input-sm"
            aria-describedby="schedule-search-hint"
            type="search"
            value={query}
            placeholder="Event, message text, message ID, unit or location"
            onChange={(event) => update("q", event.target.value)}
          />
        </label>
        <div className="join" aria-label="Calendar view">
          <button
            className="btn btn-sm join-item"
            aria-pressed={view === "day"}
            onClick={() => update("view", "day")}
          >
            Day
          </button>
          <button
            className="btn btn-sm join-item"
            aria-pressed={week}
            onClick={() => update("view", "week")}
          >
            Week
          </button>
          <button
            className="btn btn-sm join-item"
            aria-pressed={month}
            onClick={() => update("view", "month")}
          >
            Month
          </button>
        </div>
        <button className="btn btn-sm" onClick={() => move(-1)} aria-label={`Previous ${view}`}>
          ← Previous
        </button>
        <button className="btn btn-sm" onClick={() => update("date", today)}>
          Today
        </button>
        <button className="btn btn-sm" onClick={() => move(1)} aria-label={`Next ${view}`}>
          Next →
        </button>
        <label>
          {mode === "utc" ? "UTC date" : "Local date"}
          <input
            className="input input-sm"
            type="date"
            value={date}
            onChange={(e) => {
              if (e.target.value) {
                update("date", e.target.value);
              }
            }}
          />
        </label>
        <label>
          Grid interval
          <select
            className="select select-sm"
            value={interval}
            disabled={month}
            onChange={(e) => update("interval", e.target.value)}
          >
            <option value="60">One hour</option>
            <option value="30">30 minutes</option>
          </select>
        </label>
        <label>
          Visible hours ({mode === "utc" ? "UTC" : "Local"})
          <select
            className="select select-sm"
            value={`${startHour}-${endHour}`}
            disabled={month}
            onChange={(e) => update("hours", e.target.value)}
          >
            {!["0-24", "0-6", "6-12", "12-18", "18-24"].includes(`${startHour}-${endHour}`) && (
              <option value={`${startHour}-${endHour}`}>
                {startHour}:00–{endHour}:00
              </option>
            )}
            <option value="0-24">00:00–24:00 · Full day</option>
            <option value="0-6">00:00–06:00</option>
            <option value="6-12">06:00–12:00</option>
            <option value="12-18">12:00–18:00</option>
            <option value="18-24">18:00–24:00</option>
          </select>
        </label>
        <p id="schedule-search-hint" className="schedule-search-hint">
          Case-insensitive text search across all available records, not just this period.
        </p>
      </section>
      {result.isPending || result.isFetching ? (
        <p role="status">Loading schedule… Previous results are not displayed while refreshing.</p>
      ) : result.isError ? (
        <div className="alert" role="alert">
          Schedule could not be loaded. No schedule data is confirmed.
          <button className="btn btn-sm" onClick={() => void result.refetch()}>
            Retry
          </button>
        </div>
      ) : (
        <>
          <p className="preview-notice">
            {result.data.notice} · {result.data.source}
          </p>
          <details className="ship-selector">
            <summary>
              Ships ·{" "}
              {ships === undefined
                ? `All ${options.length} selected`
                : `${options.filter(([key]) => ships.has(key)).length} of ${options.length} selected`}
              {stale.length > 0 ? ` · ${stale.length} unavailable` : ""}
            </summary>
            <fieldset>
              <legend>Select ship calendars</legend>
              <div className="ship-options">
                {options.map(([key, name]) => (
                  <label key={key}>
                    <input
                      className="checkbox checkbox-sm"
                      type="checkbox"
                      checked={!ships || ships.has(key)}
                      onChange={(e) => {
                        const next = new Set(ships ?? options.map(([id]) => id));
                        if (e.target.checked) {
                          next.add(key);
                        } else {
                          next.delete(key);
                        }
                        update("ships", JSON.stringify([...next].sort()));
                      }}
                    />
                    <span
                      className="ship-marker"
                      style={{ backgroundColor: shipColor(key) }}
                      aria-hidden="true"
                    />
                    {name}
                  </label>
                ))}
              </div>
              <button
                className="btn btn-sm"
                onClick={() => update("ships", JSON.stringify(options.map(([key]) => key)))}
              >
                Select all
              </button>{" "}
              <button className="btn btn-sm" onClick={() => update("ships", "[]")}>
                Clear all
              </button>
              {stale.length > 0 && (
                <p role="status">
                  Some selected ships are unavailable in this snapshot. They remain selected; no
                  other ships were added. Select all to use the available ships, or Clear all to
                  reset.
                </p>
              )}
            </fieldset>
          </details>
          <section
            className={`timeline-section ${date === today ? "is-today" : ""}`}
            aria-labelledby="schedule-heading"
          >
            <div className="timeline-toolbar">
              <div>
                <h2 id="schedule-heading">
                  {week
                    ? `${moment.tz(from, zone).format("DD MMM YYYY")} – ${moment.tz(to, zone).subtract(1, "day").format("DD MMM YYYY")}`
                    : new Date(midnight).toLocaleDateString("en-GB", {
                        timeZone: zone,
                        weekday: month ? undefined : "long",
                        day: month ? undefined : "numeric",
                        month: "long",
                        year: "numeric",
                      })}
                  {date === today && <span className="revision">Today</span>}
                </h2>
                <p>
                  {month
                    ? `${bounds.days} calendar days · ${label} · Select a day heading to inspect`
                    : `${String(startHour).padStart(2, "0")}:00–${String(endHour).padStart(2, "0")}:00 ${label} · ${interval}-minute grid · ${week ? "Seven daily windows" : `${(to - from) / 3600000} elapsed hours`}`}
                </p>
              </div>
              {!inPeriod && discovery.timed.length > 0 && (
                <button
                  className="btn btn-sm"
                  onClick={() => {
                    const next = new URLSearchParams(canonical);
                    next.set(
                      "date",
                      civilDate(new Date(instant(discovery.timed[0].event.startAt)), zone)
                    );
                    next.set("hours", "0-24");
                    setParams(next);
                  }}
                >
                  Open available event date
                </button>
              )}
            </div>
            <p className="timeline-hint">
              {week && (
                <label>
                  Week layout
                  <select
                    className="select select-sm"
                    value={params.get("layout") === "expanded" ? "expanded" : "fit"}
                    onChange={(e) => update("layout", e.target.value)}
                  >
                    <option value="fit">Compact · Fit to screen</option>
                    <option value="expanded">Expanded · Readability</option>
                  </select>
                </label>
              )}
              {month
                ? "Standard month grid; select a date or show more events."
                : "Vertical time grid; overlapping events remain separate."}{" "}
              Events use the selected display zone and are read-only. Select an event to inspect its
              source and revision evidence.
            </p>
            {messages.length === 0 ? (
              <div className="unfinished">
                <h3>Schedule data unavailable</h3>
                <p>
                  The source returned no Message records. This is not confirmation of an empty
                  schedule.
                </p>
              </div>
            ) : ships?.size === 0 ? (
              <div className="unfinished">
                <h3>No ships selected</h3>
                <p>Open Ships and select a calendar or Select all.</p>
              </div>
            ) : discovery.messages.length === 0 ? (
              <div className="unfinished">
                <h3>No matching schedules</h3>
                <p>Change ship selection or search to inspect other available records.</p>
              </div>
            ) : (
              <DayTimeline
                messages={discovery.messages}
                from={from}
                to={to}
                interval={interval}
                returnTo={returnTo}
                view={view}
                expanded={params.get("layout") === "expanded"}
                startHour={startHour}
                endHour={endHour}
                onDay={(chosen) => {
                  const next = new URLSearchParams(canonical);
                  next.set("date", chosen);
                  next.set("view", "day");
                  setParams(next);
                }}
              />
            )}
          </section>
          <section className="upcoming-section" aria-labelledby="upcoming-heading">
            <h2 id="upcoming-heading">Next upcoming events</h2>
            <p>
              Next five matching starts from now, across all available dates · Absolute
              chronological order
            </p>
            {discovery.upcoming.length === 0 ? (
              <p>
                No upcoming timed events{query ? " match this search" : " available"}. Unresolved
                schedules are not included.
              </p>
            ) : (
              <ol>
                {discovery.upcoming.map(({ message, event }) => (
                  <li key={String(event.id)}>
                    <Link to={messageHref(message.sourceMessageId, returnTo)}>
                      <strong>{event.title}</strong>
                    </Link>
                    {event.isRevised && <span className="revision">Revised</span>}
                    <p>
                      {utc(event.startAt)} → {utc(event.endAt)} · <ShipMarker unit={event.unit} /> ·{" "}
                      {available(event.location, "Location unavailable")}
                    </p>
                    <Link to={messageHref(message.sourceMessageId, returnTo)}>
                      Source record · {message.sourceMessageId}
                    </Link>
                  </li>
                ))}
              </ol>
            )}
          </section>
          {discovery.review.length > 0 && (
            <section className="feature-note" aria-label="Needs review">
              <h2>Needs review</h2>
              <p>
                Incomplete or unresolved schedules are excluded from the timeline and upcoming
                events.
              </p>
              <ul>
                {discovery.review.map((message) => (
                  <li key={String(message.id)}>
                    <Link to={messageHref(message.sourceMessageId, returnTo)}>
                      {message.sourceMessageId} ·{" "}
                      {available(message.subject, "Subject unavailable")}
                    </Link>
                    <p>
                      {message.events.length === 0
                        ? shipName()
                        : [...new Set(message.events.map((event) => shipName(event.unit)))].join(
                            " · "
                          )}
                    </p>
                    {message.events
                      .filter((event) => !geometry(event, -8.64e15, 8.64e15))
                      .map((event) => (
                        <p key={String(event.id)}>
                          {event.title} · <ShipMarker unit={event.unit} /> ·{" "}
                          {available(event.reviewReason, "Schedule requires source review")}
                        </p>
                      ))}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
