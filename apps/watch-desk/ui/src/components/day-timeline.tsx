import { AppButton } from "./ui";
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { ExtractedEventSchema } from "../gen/app/v1/models_pb";
import type { TimelineItem } from "./source-data";
import { Link, useNavigate } from "react-router-dom";
import {
  cloneElement,
  isValidElement,
  useMemo,
  useState,
  useRef,
  createContext,
  useContext,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import {
  Calendar,
  type EventProps,
  type EventWrapperProps,
  type DayLayoutFunction,
} from "react-big-calendar";
import type { MessageRecord, ExtractedEvent } from "../gen/app/v1/models_pb";
import { instant, geometry, type CalendarView } from "./calendar-time";
import { calendarLocalizer } from "./calendar-localizer";
import { messageHref } from "./calendar-links";
import { useDisplayTime, civilDate, civilHour } from "./display-time";
import moment from "moment-timezone";
import { CommandChips, commandColor, commandKeys, commandName, type Command } from "./command-roster";
import { OptaskIcon } from "./optask-icons";
import { structuredPayload } from "./structured-message-format";
import { CalendarAccessibility } from "./calendar-accessibility";
import { useCalendarZoom } from "./calendar-zoom";
import { calendarLanes, useCalendarMeasurements } from "./calendar-layout";
import { inShipColumns, shipResources, type ShipResource } from "./calendar-resources";

interface ScheduleEntry {
  message: MessageRecord;
  event: ExtractedEvent;
  start: Date;
  end: Date;
  title: string;
  href: string;
  before: boolean;
  after: boolean;
  point?: boolean;
  reviewRequired?: boolean;
  sourceType?: string;
  commandIds?: string[];
  commands: Command[];
  resourceId?: string;
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
function sourceType(message: MessageRecord) {
  const value = structuredPayload(message)?.type;
  return typeof value === "string" ? value : undefined;
}
function eventKey(row: ScheduleEntry) {
  return `${row.message.sourceMessageId}#${row.event.sourceEventId ?? String(row.event.id)}${row.resourceId ? `:${row.resourceId}` : ""}`;
}
function EventContent({ event: row }: EventProps<ScheduleEntry>) {
  const { format: utc } = useDisplayTime();
  const disclose = useContext(WeekDisclosure);
  const information = [
    row.title,
    row.sourceType,
    row.point === true
      ? `Point: ${utc(row.event.startAt)}`
      : `Start: ${utc(row.event.startAt)}\nEnd: ${utc(row.event.endAt)}`,
    `Applicability: ${commandKeys(row.commandIds).map((key) => commandName(key, row.commands)).join(", ")}`,
    row.event.unit ? `Reported unit (not assignment): ${row.event.unit}` : undefined,
    (row.event.location ?? "") !== "" ? `Location: ${row.event.location}` : undefined,
    row.reviewRequired === true ? "Requires review" : undefined,
    row.event.isRevised ? "Revised" : undefined,
    row.before ? "Continues from earlier" : undefined,
    row.after ? "Continues later" : undefined,
  ]
    .filter((value) => value !== undefined)
    .join("\n");
  const content = (
    <>
      <OptaskIcon type={row.sourceType} />
      <span className="calendar-event-title">{row.title}</span>
    </>
  );
  const target = disclose ? (
    <button
      type="button"
      className="week-event calendar-event-card"
      data-calendar-event={eventKey(row)}
      aria-label={`${row.title}, event details`}
      title={information}
      onClick={() => disclose(row)}
    >
      {content}
    </button>
  ) : (
    <Link
      className="calendar-event-card"
      data-calendar-event={eventKey(row)}
      to={row.href}
      aria-label={`${row.title}, source record`}
      title={information}
    >
      {content}
    </Link>
  );
  return (
    <div className="calendar-event-copy">
      {row.resourceId === undefined && <CommandChips ids={row.commandIds} commands={row.commands} />}
      {target}
    </div>
  );
}

export function DayTimeline({
  messages,
  sourceItems,
  from,
  to,
  interval,
  returnTo,
  view = "day",
  startHour,
  endHour,
  onDay,
  expanded = false,
  commands = [],
  shipLayout = "combined",
  selectedShips,
}: {
  messages: MessageRecord[];
  sourceItems?: TimelineItem[];
  from: number;
  to: number;
  interval: number;
  returnTo: string;
  view?: CalendarView;
  startHour?: number;
  endHour?: number;
  onDay?: (date: string) => void;
  expanded?: boolean;
  commands?: Command[];
  shipLayout?: "combined" | "side";
  selectedShips?: Set<string>;
}) {
  const navigate = useNavigate();
  const { zone, mode, label, format } = useDisplayTime();
  const dialog = useRef<HTMLDialogElement>(null);
  const calendarRoot = useRef<HTMLDivElement>(null);
  useCalendarZoom(calendarRoot, view, interval, `${from}:${to}:${shipLayout}:${JSON.stringify(selectedShips ? [...selectedShips] : null)}`);
  const measurements = useCalendarMeasurements(calendarRoot);
  const [selected, setSelected] = useState<ScheduleEntry | null>(null);
  const [showIndex, setShowIndex] = useState(false);
  function disclose(row: ScheduleEntry) {
    setSelected(row);
    setShowIndex(false);
    dialog.current?.showModal();
  }
  const localizer = useMemo(() => calendarLocalizer(zone), [zone]);
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
  const legacyRows: ScheduleEntry[] = messages
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
                sourceType: sourceType(message),
                commands,
              },
            ]
          : [];
      })
    )
    .sort((a, b) => +a.start - +b.start);
  const parents = new Map(messages.map((message) => [message.sourceMessageId, message]));
  const rows: ScheduleEntry[] =
    sourceItems === undefined
      ? legacyRows
      : sourceItems
          .flatMap((item) => {
            const message = parents.get(item.messageKey);
            const point = item.kind === "point";
            const start = Date.parse(point ? (item.at ?? "") : (item.start ?? ""));
            const end = point ? start : Date.parse(item.end ?? "");
            if (
              !message ||
              item.kind === "unresolved" ||
              !Number.isFinite(start) ||
              !Number.isFinite(end) ||
              (!point && end <= start) ||
              (point ? start < from || start >= to : start >= to || end <= from)
            ) {
              return [];
            }
            const existing = message.events.find((event) => event.sourceEventId === item.factId);
            const event = existing ? clone(ExtractedEventSchema, existing) : create(ExtractedEventSchema);
            event.title = item.title;
            event.sourceEventId = item.factId ?? item.key;
            event.startAt = timestampFromDate(new Date(start));
            event.endAt = point ? undefined : timestampFromDate(new Date(end));
            event.scheduleStatus = "needs_review";
            return [
              {
                message,
                event,
                start: new Date(start),
                end: new Date(end),
                title: item.title,
                href: messageHref(item.messageKey, returnTo),
                before: start < from,
                after: !point && end > to,
                point,
                reviewRequired: item.reviewRequired,
                sourceType: item.sourceType,
                commandIds: item.commandIds ?? [],
                commands,
              },
            ];
          })
          .sort((a, b) => +a.start - +b.start);
  const side = view === "day" && shipLayout === "side";
  const resources = shipResources(commands, rows, selectedShips);
  const displayed = side ? inShipColumns(rows, resources) : rows;
  const minimumHeight = (row: ScheduleEntry) => measurements.titles.get(eventKey(row)) ?? 40;
  const laneGroups = side ? resources.map((r) => displayed.filter((row) => row.resourceId === r.id)) : [rows];
  const columns = Math.max(1, ...laneGroups.flatMap((group) => calendarLanes(
    group.map((row) => ({
      event: row,
      top: Math.max(from, +row.start),
      height: Math.max(+row.end - Math.max(from, +row.start), (minimumHeight(row) / measurements.height) * 86400000),
    }))
  ).map((row) => row.columns)));
  const layout: DayLayoutFunction<ScheduleEntry> = ({ events, slotMetrics }) => {
    // The library's public hook types slotMetrics as any; narrow it at this boundary.
    const metrics = slotMetrics as {
      getRange: (start: Date, end: Date) => { top: number; height: number };
    };
    return calendarLanes(
      events.map((event) => {
        const range = metrics.getRange(event.start, event.end);
        return {
          event,
          top: range.top,
          height: Math.max(range.height, (minimumHeight(event) / measurements.height) * 100),
        };
      })
    ).map(({ event, top, height, lane, columns: count }) => ({
      event,
      style: {
        top,
        height,
        width: `calc(${100 / count}% - 4px)`,
        xOffset: `calc(${(lane * 100) / count}% + 2px)`,
      },
    }));
  };
  const midnight = civilHour(civilDate(new Date(from), zone), 0, zone);
  if (side && resources.length === 0) {
    return <p className="calendar-result-limit">No valid ship calendars selected. Choose a ship or Unassigned.</p>;
  }
  return (
    <>
      <div
        ref={calendarRoot}
        style={
          view === "month"
            ? undefined
            : ({
                "--calendar-grid-min-width": `${52 + (side ? resources.length : view === "week" ? 7 : 1) * Math.max(side ? 220 : 128, columns * 128)}px`,
              } as CSSProperties)
        }
        className={`calendar-scroll ${view === "week" ? `week-scroll ${expanded ? "week-expanded" : "week-fit"}` : ""}`}
        role="region"
        aria-label={`${mode === "utc" ? "Zulu UTC" : label} calendar, scrollable`}
        tabIndex={0}
      >
        <WeekDisclosure.Provider value={view === "week" ? disclose : null}>
          <CalendarAccessibility>
            <Calendar<ScheduleEntry, ShipResource>
              className={`ship-calendar ${view === "week" ? "ship-calendar-week" : ""}${side ? " ship-calendar-resources" : ""}`}
              key={`${zone}-${from}-${to}`}
              localizer={localizer}
              date={new Date(midnight)}
              view={view}
              views={["day", "week", "month"]}
              toolbar={false}
              events={displayed}
              resources={side ? resources : undefined}
              resourceIdAccessor="id"
              resourceTitleAccessor="title"
              resourceAccessor="resourceId"
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
              dayLayoutAlgorithm={layout}
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
                className: [
                  row.event.isRevised ? "calendar-revised" : "",
                  row.point === true ? "calendar-point" : "",
                ]
                  .filter(Boolean)
                  .join(" "),
                style: { borderLeft: `5px solid ${commandColor(row.resourceId ?? commandKeys(row.commandIds)[0], commands)}` },
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
                resourceHeader: ({ resource }) => <span title={resource?.name}>{resource?.title}</span>,
                // Public 1.20 hook; @types 1.16 predates it. Suppress a retained
                // indicator when changing to a window that excludes the real now.
                ...{
                  timeIndicatorWrapper: ({ children }: { children?: ReactNode }) =>
                    Date.now() >= from && Date.now() < to ? children : null,
                },
                month: {
                  dateHeader: ({ date, label }) => (
                    <AppButton
                      variant="ghost"
                      size="xs"
                      aria-label={`Open ${civilDate(date, zone)} in Day view`}
                      onClick={() => onDay?.(civilDate(date, zone))}
                    >
                      {label}
                    </AppButton>
                  ),
                },
              }}
            />
          </CalendarAccessibility>
        </WeekDisclosure.Provider>
      </div>
      {view === "week" && rows.length > 0 && (
        <>
          <AppButton
            size="sm"
            className="week-index"
            onClick={() => {
              setShowIndex(true);
              setSelected(null);
              dialog.current?.showModal();
            }}
          >
            Events in window ({rows.length}) · Browse details
          </AppButton>
          <dialog ref={dialog} className="modal" aria-labelledby="week-detail-heading">
            <div className="modal-box week-details">
              <form method="dialog">
                <AppButton type="submit" size="sm" className="float-right">
                  Close details
                </AppButton>
              </form>
              <h2 id="week-detail-heading">
                {showIndex ? "Events in selected windows" : selected?.title}
              </h2>
              {showIndex ? (
                <ul>
                  {rows.map((row) => (
                    <li key={String(row.event.id)}>
                      <AppButton
                        variant="ghost"
                        onClick={() => {
                          setSelected(row);
                          setShowIndex(false);
                        }}
                      >
                        {row.title} · <CommandChips ids={row.commandIds} commands={commands} />
                        {row.event.isRevised ? " · Revised" : ""}
                      </AppButton>
                    </li>
                  ))}
                </ul>
              ) : (
                selected && (
                  <>
                    <p>
                      <CommandChips ids={selected.commandIds} commands={commands} /> ·{" "}
                      {(selected.event.location ?? "").trim() !== ""
                        ? selected.event.location
                        : "Location unavailable"}
                    </p>
                    <p>
                      {selected.point === true
                        ? `Point: ${format(selected.event.startAt)}`
                        : `${format(selected.event.startAt)} → ${format(selected.event.endAt)}`}
                      {selected.reviewRequired === true && " · Requires review"}
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
