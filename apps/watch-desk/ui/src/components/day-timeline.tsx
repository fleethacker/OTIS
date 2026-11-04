import { Link, useNavigate } from "react-router-dom";
import {
  cloneElement,
  isValidElement,
  useMemo,
  useState,
  useRef,
  useLayoutEffect,
  createContext,
  useContext,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { Calendar, type EventProps, type EventWrapperProps } from "react-big-calendar";
import type { MessageRecord, ExtractedEvent } from "../gen/app/v1/models_pb";
import { instant, geometry, type CalendarView } from "./calendar-time";
import { calendarLocalizer } from "./calendar-localizer";
import { messageHref } from "./calendar-links";
import { useDisplayTime, civilDate, civilHour } from "./display-time";
import moment from "moment-timezone";
import { shipColor, shipKey } from "./ship-calendars";
import { ShipMarker } from "./ship-marker";
import { CalendarAccessibility } from "./calendar-accessibility";

interface ScheduleEntry {
  message: MessageRecord;
  event: ExtractedEvent;
  start: Date;
  end: Date;
  title: string;
  href: string;
  before: boolean;
  after: boolean;
}
const WeekDisclosure = createContext<((row: ScheduleEntry) => void) | null>(null);

// RBC's public wrapper hook keeps positioning and layout. EventContent's native
// control is the sole target. Do not nest it in a button role or
// retain the duplicate selection handlers on its noninteractive container.
function SourceEventWrapper({
  children,
}: EventWrapperProps<ScheduleEntry> & { children?: ReactNode }) {
  if (!isValidElement<HTMLAttributes<HTMLElement>>(children)) {
    return children;
  }
  return cloneElement(children, {
    role: undefined,
    tabIndex: undefined,
    onClick: undefined,
    onDoubleClick: undefined,
    onKeyDown: undefined,
    onKeyPress: undefined,
  });
}
function EventContent({ event: row }: EventProps<ScheduleEntry>) {
  const { format: utc } = useDisplayTime();
  const disclose = useContext(WeekDisclosure);
  if (disclose) {
    return (
      <button
        type="button"
        className="week-event"
        aria-label={`${row.title}, event details`}
        onClick={() => disclose(row)}
      >
        <strong>
          {row.event.isRevised ? "Revised · " : ""}
          {row.title}
        </strong>
        <ShipMarker unit={row.event.unit} />
      </button>
    );
  }
  return (
    <Link to={row.href} aria-label={`${row.title}, source record`}>
      <strong>{row.title}</strong>
      <ShipMarker unit={row.event.unit} />
      {row.event.isRevised && " · Revised"}
      <span className="calendar-event-time">
        {utc(row.event.startAt)} → {utc(row.event.endAt)}
      </span>
      {row.before && <span className="calendar-continuation"> · Continues from earlier</span>}
      {row.after && <span className="calendar-continuation"> · Continues later</span>}
    </Link>
  );
}

export function DayTimeline({
  messages,
  from,
  to,
  interval,
  returnTo,
  view = "day",
  startHour,
  endHour,
  onDay,
  expanded = false,
}: {
  messages: MessageRecord[];
  from: number;
  to: number;
  interval: number;
  returnTo: string;
  view?: CalendarView;
  startHour?: number;
  endHour?: number;
  onDay?: (date: string) => void;
  expanded?: boolean;
}) {
  const navigate = useNavigate();
  const { zone, mode, label, format } = useDisplayTime();
  const container = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [selected, setSelected] = useState<ScheduleEntry | null>(null);
  const [showIndex, setShowIndex] = useState(false);
  useLayoutEffect(() => {
    if (view !== "week" || !container.current) {
      return;
    }
    const node = container.current;
    const measure = () =>
      node.style.setProperty(
        "--week-fit-height",
        `${Math.max(200, window.innerHeight - node.getBoundingClientRect().top - window.scrollY - 12)}px`
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(document.querySelector("main") ?? node);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [view]);
  function disclose(row: ScheduleEntry) {
    setSelected(row);
    setShowIndex(false);
    dialog.current?.showModal();
  }
  const localizer = useMemo(() => calendarLocalizer(zone), [zone]);
  const isMonth = view === "month";
  // A week has seven independent clock windows, not one long min/max range.
  const windows =
    view === "week"
      ? Array.from({ length: 7 }, (_, index) => {
          const day = moment.tz(from, zone).add(index, "day").format("YYYY-MM-DD");
          return {
            from: civilHour(day, startHour ?? 0, zone),
            to: civilHour(day, endHour ?? 24, zone),
          };
        })
      : [];
  const rows: ScheduleEntry[] = messages
    .flatMap((message) =>
      message.events.flatMap((event) => {
        const position = geometry(event, from, to);
        const parts = windows.map((window) => geometry(event, window.from, window.to));
        if (view === "week" && !parts.some((part) => part !== null)) {
          return [];
        }
        return position
          ? [
              {
                message,
                event,
                start: new Date(instant(event.startAt)),
                end: new Date(instant(event.endAt)),
                title: event.title,
                href: messageHref(message.sourceMessageId, returnTo),
                before: position.before || parts.some((part) => part?.before === true),
                after: position.after || parts.some((part) => part?.after === true),
              },
            ]
          : [];
      })
    )
    .sort((a, b) => +a.start - +b.start);
  const midnight = civilHour(civilDate(new Date(from), zone), 0, zone);
  return (
    <>
      {rows.length === 0 && (
        <div className="unfinished">
          <h3>No timed events in this {isMonth ? "month" : "window"}</h3>
          <p>
            Try another {label} {isMonth ? "month" : "date or a wider hours window"}. Unresolved
            schedules are not plotted.
          </p>
        </div>
      )}
      <div
        ref={container}
        className={`calendar-scroll ${view === "week" ? `week-scroll ${expanded ? "week-expanded" : "week-fit"}` : ""}`}
        role="region"
        aria-label={`${mode === "utc" ? "Zulu UTC" : label} calendar, scrollable`}
        tabIndex={0}
      >
        <WeekDisclosure.Provider value={view === "week" ? disclose : null}>
          <CalendarAccessibility>
            <Calendar<ScheduleEntry>
              className={`ship-calendar ${view === "week" ? "ship-calendar-week" : ""}`}
              key={`${zone}-${from}-${to}`}
              localizer={localizer}
              date={new Date(midnight)}
              view={view}
              views={["day", "week", "month"]}
              toolbar={false}
              events={rows}
              onNavigate={(date) => onDay?.(civilDate(date, zone))}
              onView={() => {
                /* View is owned by the URL controls. */
              }}
              onDrillDown={(date) => onDay?.(civilDate(date, zone))}
              onSelectEvent={(row) => {
                void navigate(row.href);
              }}
              selectable={false}
              showMultiDayTimes
              dayLayoutAlgorithm="no-overlap"
              popup
              step={interval}
              timeslots={1}
              min={
                new Date(
                  startHour === undefined
                    ? from
                    : civilHour(civilDate(new Date(from), zone), startHour, zone)
                )
              }
              max={
                new Date(
                  endHour === undefined
                    ? to - 1
                    : civilHour(civilDate(new Date(from), zone), endHour, zone) - 1
                )
              }
              scrollToTime={new Date(from)}
              getNow={() => new Date()}
              tooltipAccessor={() => ""}
              eventPropGetter={(row) => ({
                className: row.event.isRevised ? "calendar-revised" : "",
                style: { borderLeft: `5px solid ${shipColor(shipKey(row.event.unit))}` },
              })}
              formats={{
                timeGutterFormat: (date) =>
                  moment.tz(date, zone).format(mode === "utc" ? "HH:mm" : "HH:mm [UTC]Z"),
                dayHeaderFormat: (date) =>
                  view === "week"
                    ? moment.tz(date, zone).format("ddd DD MMM")
                    : `${moment.tz(date, zone).format("dddd DD MMMM")} · ${label}`,
                eventTimeRangeFormat: () => "",
                eventTimeRangeStartFormat: () => "",
                eventTimeRangeEndFormat: () => "",
              }}
              components={{
                eventWrapper: SourceEventWrapper,
                event: EventContent,
                // Public 1.20 hook; @types 1.16 predates it. Suppress a retained
                // indicator when changing to a window that excludes the real now.
                ...{
                  timeIndicatorWrapper: ({ children }: { children?: ReactNode }) =>
                    Date.now() >= from && Date.now() < to ? children : null,
                },
                month: {
                  dateHeader: ({ date, label }) => (
                    <button
                      className="btn btn-ghost btn-xs"
                      aria-label={`Open ${civilDate(date, zone)} in Day view`}
                      onClick={() => onDay?.(civilDate(date, zone))}
                    >
                      {label}
                    </button>
                  ),
                },
              }}
            />
          </CalendarAccessibility>
        </WeekDisclosure.Provider>
      </div>
      {view === "week" && (
        <>
          <button
            className="btn btn-sm week-index"
            onClick={() => {
              setShowIndex(true);
              setSelected(null);
              dialog.current?.showModal();
            }}
          >
            Events in window ({rows.length}) · Browse details
          </button>
          <dialog ref={dialog} className="modal" aria-labelledby="week-detail-heading">
            <div className="modal-box week-details">
              <form method="dialog">
                <button className="btn btn-sm float-right">Close details</button>
              </form>
              <h2 id="week-detail-heading">
                {showIndex ? "Events in selected windows" : selected?.title}
              </h2>
              {showIndex ? (
                <ul>
                  {rows.map((row) => (
                    <li key={String(row.event.id)}>
                      <button
                        className="btn btn-ghost"
                        onClick={() => {
                          setSelected(row);
                          setShowIndex(false);
                        }}
                      >
                        {row.title} · <ShipMarker unit={row.event.unit} />
                        {row.event.isRevised ? " · Revised" : ""}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                selected && (
                  <>
                    <p>
                      <ShipMarker unit={selected.event.unit} /> ·{" "}
                      {(selected.event.location ?? "").trim() !== ""
                        ? selected.event.location
                        : "Location unavailable"}
                    </p>
                    <p>
                      {format(selected.event.startAt)} → {format(selected.event.endAt)}
                    </p>
                    {selected.before && <p>Continues from earlier than a selected window.</p>}
                    {selected.after && <p>Continues later than a selected window.</p>}
                    {selected.event.isRevised && (
                      <p className="revision-history">
                        Revised
                        {selected.event.revisions.length === 0
                          ? " · Prior schedule unavailable"
                          : ""}
                      </p>
                    )}
                    {selected.event.revisions.map((revision) => (
                      <p key={revision.sequence}>
                        {revision.description} · Prior: {format(revision.priorStartAt)} →{" "}
                        {format(revision.priorEndAt)}
                      </p>
                    ))}
                    <Link className="btn btn-primary" to={selected.href}>
                      Source record · {selected.message.sourceMessageId}
                    </Link>
                  </>
                )
              )}
            </div>
          </dialog>
        </>
      )}
    </>
  );
}
