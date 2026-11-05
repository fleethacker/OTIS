import { Link } from "react-router-dom";
import { messageHref } from "./calendar-links";
import type { TimelineItem } from "./source-data";
import { type Command } from "./command-roster";
import { CommandChips } from "./command-chips";
import { reviewTime } from "./review-time";

/** A bounded source projection, never a count of all unresolved tasking. */
export function CalendarReview({
  items,
  commands = [],
  limited,
  filtered,
  notQueried = false,
  returnTo,
  onShowAll,
}: {
  items?: TimelineItem[];
  commands?: Command[];
  limited: boolean;
  filtered: boolean;
  notQueried?: boolean;
  returnTo: string;
  onShowAll: () => void;
}) {
  return (
    <section className="calendar-review" aria-label="Needs review">
      <details open>
        <summary>
          Needs review ·{" "}
          {notQueried
            ? "not queried"
            : items === undefined
              ? "unavailable"
              : `${items.length} returned`}
        </summary>
        <div className="calendar-review-content">
          <p>
            Undated items appear in every calendar view because they cannot be placed on a date.
            These returned source facts are not a complete review queue; timed facts also need
            operational confirmation.
          </p>
          {limited && (
            <p className="calendar-review-limit">
              Source limit reached; review results are incomplete.
            </p>
          )}
          {filtered && (
            <p>
              Ships or search hide other records. Hidden review counts are unavailable.{" "}
              <button className="btn btn-sm" onClick={onShowAll}>
                Show all ships and clear search
              </button>
            </p>
          )}
          {notQueried ? (
            <p>No ships selected; review was not queried.</p>
          ) : items === undefined ? (
            <p>Review data unavailable.</p>
          ) : items.length === 0 ? (
            <p>
              {filtered
                ? "No review items match the current filters in returned records."
                : "No unresolved times in the returned records."}
            </p>
          ) : (
            <ul>
              {items.map((item) => (
                <li key={item.key}>
                  <CommandChips ids={item.commandIds} commands={commands} />{" "}
                  {item.messageKey ? (
                    <Link to={messageHref(item.messageKey, returnTo)}>{item.title}</Link>
                  ) : (
                    <strong>{item.title}</strong>
                  )}
                  <p>{reviewTime(item)}</p>
                  <small>
                    {item.messageKey || "Source unavailable"}
                    {item.messageKey !== "" && (item.factId ?? "") !== ""
                      ? ` · Fact ${item.factId}`
                      : ""}
                  </small>
                </li>
              ))}
            </ul>
          )}
        </div>
      </details>
    </section>
  );
}
