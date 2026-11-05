import { Link } from "react-router-dom";
import { messageHref } from "./calendar-links";
import type { TimelineItem } from "./source-data";

/** A bounded source projection, never a count of all unresolved tasking. */
export function CalendarReview({
  items,
  limited,
  filtered,
  returnTo,
  onShowAll,
}: {
  items?: TimelineItem[];
  limited: boolean;
  filtered: boolean;
  returnTo: string;
  onShowAll: () => void;
}) {
  return (
    <section className="calendar-review" aria-label="Needs review">
      <details open>
        <summary>Needs review · {items === undefined ? "unavailable" : `${items.length} returned`}</summary>
        <div className="calendar-review-content">
          <p>
            Unresolved times are not plotted. These are returned source facts, not a complete
            review queue; their dates may be unknown. Timed facts also need operational confirmation.
          </p>
          {limited && <p className="calendar-review-limit">Source limit reached; review results are incomplete.</p>}
          {filtered && (
            <p>
              Ships or search hide other records. Hidden review counts are unavailable. {" "}
              <button className="btn btn-sm" onClick={onShowAll}>Show all ships and clear search</button>
            </p>
          )}
          {items === undefined ? (
            <p>Review data unavailable.</p>
          ) : items.length === 0 ? (
            <p>No unresolved times in the returned records.</p>
          ) : (
            <ul>
              {items.map((item) => (
                <li key={item.key}>
                  {item.messageKey ? (
                    <Link to={messageHref(item.messageKey, returnTo)}>{item.title}</Link>
                  ) : <strong>{item.title}</strong>}
                  <p>{item.reason || "Source time is unresolved."}</p>
                  <small>
                    {item.messageKey || "Source unavailable"}
                    {item.messageKey && item.factId ? ` · Fact ${item.factId}` : ""}
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
