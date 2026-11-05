import { AppButton, Notice, TextInput } from "../components/ui";
import { useSettings } from "../components/settings-data";
import { useSearchParams } from "react-router-dom";
import { useState } from "react";
import { Link } from "react-router-dom";
import { calendarSearch } from "../components/calendar-search";
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
  const { shared } = useSettings();
  const { zone } = useDisplayTime();
  const roster = useCommands();
  const [params, changeParams] = useCalendarParams();
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
  const ships = params.has("ships")
    ? readShips(params.get("ships"))
    : (shared?.settings.commandIds.length ?? 0) > 0
      ? new Set((shared?.settings.commandIds ?? []).map((id) => `unit:${id}`))
      : null;
  const dataset = params.get("dataset") === "legacy" ? "legacy" : "canonical";
  const filters = ships
      ? {
          commandIds: [...ships].filter((v) => v.startsWith("unit:")).map((v) => v.slice(5)),
          unassignedOnly: ships.has("unassigned:"),
          noCommands:
            ships.size === 0 ||
            [...ships].some((v) => !v.startsWith("unit:") && v !== "unassigned:"),
        }
      : {};
  const noShips = ships !== undefined && (filters.noCommands === true ||
    (!!roster.data && !roster.isError && ![...ships].some((key) => key === "unassigned:" || roster.data.commands.some((c) => key === `unit:${c.id}`))));
  // Fetch the bounded timeline independently: passage retrieval must not hide title hits.
  const result = useSource("timeline", {
    dataset, query: "", mode: "hybrid",
    from: new Date(from).toISOString(), to: new Date(to).toISOString(), filters,
  }, !noShips);
  const searching = dataset === "canonical" && debounced.trim() !== "";
  const keywords = useSource("search", { dataset, query: debounced, mode: "keyword", filters }, searching && query === debounced && !noShips);
  const messages = result.data?.messages ?? [];
  const refreshing = !noShips && (result.isPending || result.isFetching || query !== debounced);
  const keywordKeys = new Set(!keywords.isError && !keywords.isFetching ? keywords.data?.messages.map((m) => m.sourceMessageId) : []);
  const timelineItems = calendarSearch(result.data?.meta.timelineItems, messages, debounced, keywordKeys);
  const reviewItems = calendarSearch(result.data?.meta.reviewItems, messages, debounced, keywordKeys);
  const searchLimited = searching && (keywords.data?.meta.windowLimited === true || !!keywords.data?.meta.nextPageToken);
  const canonical = new URLSearchParams(params);
  canonical.set("date", date);
  canonical.set("view", view);
  canonical.set("interval", String(interval));
  canonical.delete("hours");
  const returnTo = `/calendar?${canonical.toString()}`;
  function setParams(change: (next: URLSearchParams) => void, replace = false) {
    changeParams((next) => {
      if (!next.has("date")) next.set("date", date);
      if (!next.has("view")) next.set("view", view);
      if (!next.has("interval")) next.set("interval", String(interval));
      next.delete("hours");
      change(next);
    }, replace);
  }
  function update(key: string, value: string) {
    setParams((next) => next.set(key, value), key === "q");
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
        onChange={(selected) => setParams((next) => {
          if (selected === undefined) next.delete("ships");
          else next.set("ships", JSON.stringify([...selected].sort()));
        })}
      />
      <div className="calendar-main">
      <section className="calendar-controls" aria-label="Calendar controls">
        <label className="schedule-search">
          Search schedule
          <TextInput
            className="input-sm"
            type="search"
            value={query}
            placeholder="Search"
            onChange={(event) => update("q", event.target.value)}
          />
        </label>
        <div className="join" aria-label="Calendar view">
          <AppButton
            size="sm"
            className="join-item"
            aria-pressed={view === "day"}
            onClick={() => update("view", "day")}
          >
            Day
          </AppButton>
          <AppButton
            size="sm"
            className="join-item"
            aria-pressed={week}
            onClick={() => update("view", "week")}
          >
            Week
          </AppButton>
          <AppButton
            size="sm"
            className="join-item"
            aria-pressed={month}
            onClick={() => update("view", "month")}
          >
            Month
          </AppButton>
        </div>
        <AppButton size="sm" onClick={() => move(-1)} aria-label={`Previous ${view}`}>
          ← Previous
        </AppButton>
        <AppButton size="sm" onClick={() => update("date", today)}>
          Today
        </AppButton>
        <AppButton size="sm" onClick={() => move(1)} aria-label={`Next ${view}`}>
          Next →
        </AppButton>
        <label>
          {zone === "UTC" ? "UTC date" : "Date"}
          <TextInput
            className="input-sm"
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
      {!noShips && query.trim() && <div className="calendar-search-status">
        <p>Calendar filtered by “{query}” · local lexical title/header matches are always included within returned records.</p>
        {searching && (keywords.isPending || keywords.isFetching || query !== debounced ? <p>Loading keyword passage matches…</p> : keywords.isError ? <p role="alert">Keyword search unavailable; showing local title/header matches only. <button className="btn btn-xs" onClick={() => { void keywords.refetch(); }}>Retry search</button></p> : <p>Executed passage search: {keywords.data?.meta.executedMode ?? "not reported by server"}. Passage matching may match any query word; all query words must match a local title/header.</p>)}
        {searchLimited && <p>Only the returned keyword page is included; additional matches may exist.</p>}
        <Link to={`/messages?${new URLSearchParams({ q: query, returnTo })}`}>Find related messages</Link>
        <span> · Related results are not automatically plotted.</span>
      </div>}
      {refreshing && <p role="status">Loading schedule…</p>}
      {result.isError && (
        <Notice role="alert" tone="error">
          Calendar could not be loaded. {result.error.message}
          <AppButton size="sm" onClick={() => void result.refetch()}>
            Retry
          </AppButton>
        </Notice>
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
        {noShips ? <p className="calendar-result-limit">No ships selected. Choose a ship or Unassigned.</p> : <DayTimeline
          commands={roster.isError ? [] : roster.data?.commands}
          shipLayout={params.get("shipLayout") === "side" ? "side" : "combined"}
          selectedShips={ships}
          ready={!refreshing && !result.isError}
          messages={result.isError || refreshing ? [] : messages}
          sourceItems={
            dataset === "canonical"
              ? result.isError || refreshing
                ? []
                : (timelineItems ?? [])
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
          onDay={(chosen) => setParams((next) => {
            next.set("date", chosen);
            next.set("view", "day");
          })}
        />}
      </section>
      {dataset === "canonical" && (noShips || (result.data && !refreshing && !result.isError)) && (
        <CalendarReview
          items={noShips ? undefined : reviewItems}
          notQueried={noShips}
          commands={roster.isError ? [] : roster.data?.commands}
          limited={!noShips && (result.data?.meta.windowLimited === true || searchLimited)}
          filtered={ships !== undefined || query.trim() !== ""}
          returnTo={returnTo}
          onShowAll={() => setParams((next) => {
            next.delete("ships");
            next.delete("q");
          })}
        />
      )}
      </div>
    </div>
  );
}
