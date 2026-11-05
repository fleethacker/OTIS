import { useSearchParams } from "react-router-dom";
import { useState } from "react";
import moment from "moment-timezone";
import type { RouteMeta } from "../route-registry";
import { useSource, useDebounced } from "../components/source-data";
import { DayTimeline } from "../components/day-timeline";
import { CalendarReview } from "../components/calendar-review";
import {
  utcDate,
  monthBounds,
  moveMonth,
  weekBounds,
  type CalendarView,
} from "../components/calendar-time";
import { useDisplayTime, civilDate, civilHour } from "../components/display-time";
import { readShips } from "../components/ship-calendars";
import { useCommands } from "../components/command-roster";
import { ShipsSidebar } from "../components/ships-sidebar";

export const route: RouteMeta = { path: "/calendar", label: "Calendar", order: 0 };
export default function Calendar() {
  const { zone } = useDisplayTime();
  const roster = useCommands();
  const [params, setParams] = useSearchParams();
  const today = civilDate(new Date(), zone);
  const [landingDate] = useState(today);
  const date = utcDate(params.get("date"), landingDate);
  const view: CalendarView =
    params.get("view") === "month" ? "month" : params.get("view") === "week" ? "week" : "day";
  const month = view === "month";
  const week = view === "week";
  const bounds = monthBounds(date, zone);
  const weekly = weekBounds(date, zone);
  const interval = params.get("interval") === "30" ? 30 : 60;
  const midnight = civilHour(date, 0, zone);
  const from = month ? bounds.from : week ? weekly.from : midnight;
  const to = month ? bounds.to : week ? weekly.to : civilHour(date, 24, zone);
  const query = params.get("q") ?? "";
  const debounced = useDebounced(query);
  const ships = readShips(params.get("ships"));
  const dataset = params.get("dataset") === "legacy" ? "legacy" : "canonical";
  const result = useSource("timeline", {
    dataset,
    query: debounced,
    mode: "hybrid",
    from: new Date(from).toISOString(),
    to: new Date(to).toISOString(),
    filters: ships
      ? {
          commandIds: [...ships].filter((v) => v.startsWith("unit:")).map((v) => v.slice(5)),
          unassignedOnly: ships.has("unassigned:"),
          noCommands:
            ships.size === 0 ||
            [...ships].some((v) => !v.startsWith("unit:") && v !== "unassigned:"),
        }
      : {},
  });
  const messages = result.data?.messages ?? [];
  const refreshing = result.isPending || result.isFetching || query !== debounced;
  const canonical = new URLSearchParams(params);
  canonical.set("date", date);
  canonical.set("view", view);
  canonical.set("interval", String(interval));
  canonical.delete("hours");
  const returnTo = `/calendar?${canonical.toString()}`;
  function update(key: string, value: string) {
    const next = new URLSearchParams(canonical);
    next.set(key, value);
    setParams(next, { replace: key === "q" });
  }
  function move(direction: number) {
    update(
      "date",
      month
        ? moveMonth(date, direction)
        : moment
            .tz(midnight, zone)
            .add(direction * (week ? 7 : 1), "day")
            .format("YYYY-MM-DD")
    );
  }
  return (
    <div className={`calendar-page calendar-with-ships${week ? " calendar-page-week" : ""}`}>
      <ShipsSidebar
        roster={roster.data}
        selected={ships}
        pending={roster.isPending}
        error={roster.isError ? roster.error.message : undefined}
        retry={() => { void roster.refetch(); }}
        onChange={(selected) => {
          const next = new URLSearchParams(canonical);
          if (selected === undefined) next.delete("ships");
          else next.set("ships", JSON.stringify([...selected].sort()));
          setParams(next);
        }}
      />
      <div className="calendar-main">
      <section className="calendar-controls" aria-label="Calendar controls">
        <label className="schedule-search">
          Search schedule
          <input
            className="input input-sm"
            type="search"
            value={query}
            placeholder="Search"
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
          UTC date
          <input
            className="input input-sm"
            type="date"
            value={date}
            onChange={(event) => {
              if (event.target.value) {
                update("date", event.target.value);
              }
            }}
          />
        </label>
      </section>
      {refreshing && <p role="status">Loading schedule…</p>}
      {result.isError && (
        <div className="alert" role="alert">
          Calendar could not be loaded. {result.error.message}
          <button className="btn btn-sm" onClick={() => void result.refetch()}>
            Retry
          </button>
        </div>
      )}
      <section
        className={`timeline-section ${date === today ? "is-today" : ""}`}
        aria-labelledby="schedule-heading"
      >
        {result.data?.meta.windowLimited === true && !refreshing && !result.isError && (
          <p className="calendar-result-limit" role="status">
            Partial source results. Narrow the range or search; counts cover returned records only.
          </p>
        )}
        <div className="timeline-toolbar">
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
        </div>
        <DayTimeline
          commands={roster.isError ? [] : roster.data?.commands}
          messages={result.isError || refreshing ? [] : messages}
          sourceItems={
            dataset === "canonical"
              ? result.isError || refreshing
                ? []
                : (result.data?.meta.timelineItems ?? [])
              : undefined
          }
          from={from}
          to={to}
          interval={interval}
          returnTo={returnTo}
          view={view}
          expanded={params.get("layout") === "expanded"}
          startHour={0}
          endHour={24}
          onDay={(chosen) => {
            const next = new URLSearchParams(canonical);
            next.set("date", chosen);
            next.set("view", "day");
            setParams(next);
          }}
        />
      </section>
      {dataset === "canonical" && result.data && !refreshing && !result.isError && (
        <CalendarReview
          items={result.data.meta.reviewItems}
          commands={roster.isError ? [] : roster.data?.commands}
          limited={result.data.meta.windowLimited === true}
          filtered={ships !== undefined || query.trim() !== ""}
          returnTo={returnTo}
          onShowAll={() => {
            const next = new URLSearchParams(canonical);
            next.delete("ships");
            next.delete("q");
            setParams(next);
          }}
        />
      )}
      </div>
    </div>
  );
}
