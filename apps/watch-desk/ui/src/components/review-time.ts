import type { TimelineItem } from "./source-data";

const reasons: Record<string, string> = {
  missing_date: "No date in source",
  missing_date_and_zone: "Date and time zone missing",
  missing_month_and_year: "Month and year missing",
  missing_year: "Year missing",
  missing_day_time_and_year: "Day, time and year missing",
  condition_not_scheduled: "Conditional, not scheduled",
  not_available_withheld_or_inapplicable: "Time unavailable, withheld or inapplicable",
  open_ended: "End is open; no duration supplied",
  unresolved: "Time could not be resolved",
};
const endpoints: Record<string, string> = {
  time: "Time",
  start: "Start",
  end: "End",
  as_of: "As of",
  deadline: "Deadline",
};
export function reviewTime(item: TimelineItem) {
  const details = item.timeDetails ?? [];
  const display = (detail: (typeof details)[number]) =>
    detail.label ?? detail.clock?.replace(":", "") ?? detail.at;
  if (item.reasonCode === "non_positive_interval") {
    return "End is not after start · not plotted";
  }
  if (item.reasonCode === "missing_time") {
    return "No date or time supplied · not plotted";
  }
  const start = details.find((d) => d.endpoint === "start");
  const end = details.find((d) => d.endpoint === "end");
  if (
    start?.status === "missing_date" &&
    end?.status === "missing_date" &&
    (display(start) ?? "") !== "" &&
    (display(end) ?? "") !== ""
  ) {
    return `No date in source: ${display(start)}–${display(end)} (day not given${(start.label ?? "") !== "" && (end.label ?? "") !== "" ? "" : "; normalized clocks"}) · not plotted`;
  }
  if (details.length > 0) {
    const copy = details.map((detail) => {
      const reason =
        detail.status !== undefined && detail.status !== ""
          ? (reasons[detail.status] ?? "Time could not be resolved")
          : (detail.at ?? "") !== ""
            ? "Resolved endpoint"
            : "Date/time unresolved";
      const value = display(detail);
      return `${endpoints[detail.endpoint] ?? "Time"}: ${reason}${(value ?? "") !== "" ? ` — ${value}${(detail.clock ?? "") !== "" && (detail.label ?? "") === "" ? " (normalized clock)" : ""}` : ""}`;
    });
    if ((start?.at ?? "") !== "" && end === undefined) {
      copy.push("End: not supplied");
    }
    if ((end?.at ?? "") !== "" && start === undefined) {
      copy.push("Start: not supplied");
    }
    return `${copy.join("; ")} · not plotted`;
  }
  return `${(item.reason ?? "") === "" ? "Source date/time details unavailable" : item.reason} · not plotted`;
}
