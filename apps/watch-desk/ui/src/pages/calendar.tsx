import { AppButton, Notice, TextInput } from "../components/ui";
import { CalendarParamsProvider, useCalendarParams } from "../components/calendar-params";
import { BrowserPreferenceScope, CalendarPreferencesProvider } from "../components/calendar-preferences";
import { useSettings } from "../components/settings-data";
import { useContext, useState } from "react";
import { TbRefresh } from "react-icons/tb";
import { useAccountSettings } from "../components/session";
import moment from "moment-timezone";
import type { RouteMeta } from "../route-registry";
import { useSource, useDebounced } from "../components/source-data";
import { DayTimeline } from "../components/day-timeline";
import {
  utcDate,
  monthBounds,
  moveMonth,
  weekBounds,
  type CalendarView,
} from "../components/calendar-time";
import { useDisplayTime, civilDate, civilHour } from "../components/display-time";
import { ALL_SHIPS, effectiveShips, selectedShipFilters } from "../components/ship-calendars";
import { WatchTurnoverPanel } from "../components/watch-turnover-panel";
import { useCommands } from "../components/command-roster";
import { ShipsSidebar } from "../components/ships-sidebar";
import { Link } from "react-router-dom";
import { messageHref } from "../components/calendar-links";
import { reviewTime } from "../components/review-time";
import { commandKeys } from "../components/command-roster";

export const route: RouteMeta = { path: "/calendar", label: "Calendar", order: 0 };
export default function Calendar() {
  const scope = useContext(BrowserPreferenceScope);
  const settings = useAccountSettings();
  return <CalendarPreferencesProvider scope={scope} defaultView={settings.defaultCalendarView}>
    <CalendarParamsProvider><CalendarPage /></CalendarParamsProvider>
  </CalendarPreferencesProvider>;
}
function CalendarPage() {
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
  const ships = effectiveShips(params.get("ships"), { defaultShips: roster.data?.defaultShips ?? shared?.settings.defaultShips ?? [], commandIds: shared?.settings.commandIds ?? [] });
  const dataset = params.get("dataset") === "legacy" ? "legacy" : "canonical";
  const filters = selectedShipFilters(ships);
  const noShips = ships !== undefined && (filters.noCommands === true ||
    (!!roster.data && !roster.isError && ![...ships].some((key) => key === "unassigned:" || roster.data.commands.some((c) => key === `unit:${c.id}`))));
  const result = useSource("timeline", {
    dataset, query: debounced, mode: "hybrid",
    from: new Date(from).toISOString(), to: new Date(to).toISOString(), filters,
  }, !noShips);
  const awaitingSearch = query !== debounced;
  const visibleData = awaitingSearch ? undefined : result.data;
  const messages = visibleData?.messages ?? [];
  const reviewItems = (visibleData?.meta.reviewItems ?? []).filter((item) =>
    ships === undefined || commandKeys(item.placementIds ?? item.commandIds).some((key) => ships.has(key))
  );
  const refreshing = !noShips && (result.isPending || result.isFetching || awaitingSearch);
  const hasSnapshot = visibleData !== undefined;
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
          if (selected === undefined) next.set("ships", ALL_SHIPS);
          else next.set("ships", JSON.stringify([...selected].sort()));
        })}
        onReset={() => setParams((next) => next.delete("ships"))}
      />
      <div className="calendar-main">
      {dataset === "canonical" && <WatchTurnoverPanel
        turnovers={roster.data?.turnoverUtc ?? shared?.settings.turnoverUtc}
        defaultShips={roster.data?.defaultShips}
        commands={roster.isError ? [] : roster.data?.commands}
        returnTo={returnTo}
      />}
      <section className="calendar-controls" aria-label="Calendar controls">
        <TextInput
          className="schedule-search input-sm"
          type="search"
          aria-label="Search schedule"
          title="Search schedule"
          value={query}
          placeholder="Search"
          onChange={(event) => update("q", event.target.value)}
        />
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
        {view === "day" && (
          <div className="join" aria-label="Day ship layout">
            <AppButton
              size="sm"
              className="join-item"
              aria-pressed={params.get("shipLayout") !== "side"}
              onClick={() => update("shipLayout", "combined")}
            >
              Combined
            </AppButton>
            <AppButton
              size="sm"
              className="join-item"
              aria-pressed={params.get("shipLayout") === "side"}
              onClick={() => update("shipLayout", "side")}
            >
              Side by side
            </AppButton>
          </div>
        )}
        <AppButton size="sm" onClick={() => move(-1)} aria-label={`Previous ${view}`}>
          ← Previous
        </AppButton>
        <AppButton size="sm" onClick={() => update("date", today)}>
          Today
        </AppButton>
        <AppButton size="sm" onClick={() => move(1)} aria-label={`Next ${view}`}>
          Next →
        </AppButton>
        <TextInput
          className="calendar-date input-sm"
          type="date"
          aria-label={zone === "UTC" ? "UTC date" : "Date"}
          title={`Date (${zone})`}
          value={date}
          onChange={(event) => {
            if (event.target.value) {
              update("date", event.target.value);
            }
          }}
        />
        <AppButton
          size="sm"
          aria-label="Refresh calendar"
          title={result.dataUpdatedAt > 0 ? `Last refreshed: ${new Date(result.dataUpdatedAt).toISOString()}` : "Refresh calendar"}
          disabled={refreshing || noShips}
          onClick={() => void result.refetch()}
        >
          <TbRefresh aria-hidden="true" />
        </AppButton>
      </section>
      {refreshing && !hasSnapshot && <p role="status">Loading schedule…</p>}
      {!noShips && result.isError && (
        <Notice role="alert" tone="error">
          {hasSnapshot ? "Refresh failed. Showing saved schedule." : "Calendar could not be loaded."} {result.error.message}
          <AppButton size="sm" onClick={() => void result.refetch()}>
            Retry
          </AppButton>
        </Notice>
      )}
      <section
        className={`timeline-section ${date === today ? "is-today" : ""}`}
        aria-labelledby="schedule-heading"
      >
        {visibleData?.meta.windowLimited === true && (
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
          ready={hasSnapshot}
          messages={messages}
          sourceItems={
            dataset === "canonical"
              ? visibleData?.meta.timelineItems ?? []
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
        {dataset === "canonical" && reviewItems.length > 0 && <details className="calendar-review-list">
          <summary>Source candidates needing review ({reviewItems.length})</summary>
          <ul>{reviewItems.map((item) => <li key={item.key}>
            {item.movementAction && <span className="movement-action-badge">{item.movementAction}</span>}
            <Link to={messageHref(item.messageKey, returnTo)}>{item.title}</Link>
            <span className="movement-review-badge">Review</span>
            <p>{reviewTime(item)}{item.unitMatchReview === true ? " · Ship name needs matching review" : ""}</p>
          </li>)}</ul>
        </details>}
      </section>
      </div>
    </div>
  );
}
