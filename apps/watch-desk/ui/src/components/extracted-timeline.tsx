import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { Link } from "react-router-dom";
import { messageHref } from "./calendar-links";
import { useDisplayTime } from "./display-time";
import type { TimelineItem } from "./source-data";

export function ExtractedTimeline({
  items,
  from,
  to,
  returnTo,
  limited,
}: {
  items: TimelineItem[];
  from: number;
  to: number;
  returnTo: string;
  limited?: boolean;
}) {
  const { format } = useDisplayTime();
  const ordered = [...items].sort(
    (a, b) => Date.parse(a.at ?? a.start ?? "") - Date.parse(b.at ?? b.start ?? "")
  );
  return (
    <section aria-label="Extracted source timeline">
      {limited === true && (
        <p role="status">Result window reached. Narrow the date or command selection.</p>
      )}
      {ordered.length === 0 && <p>No timed events available for this range.</p>}
      <div className="extracted-axis">
        <time>{new Date(from).toISOString()}</time>
        <time>{new Date(to).toISOString()}</time>
      </div>
      <ol className="extracted-timeline">
        {ordered.map((item) => {
          const a = Date.parse(item.at ?? item.start ?? "");
          const b = Date.parse(item.end ?? item.at ?? "");
          const left = Math.max(0, Math.min(100, ((a - from) / (to - from)) * 100));
          const width = Math.max(0, Math.min(100, ((b - from) / (to - from)) * 100) - left);
          return (
            <li key={item.key}>
              <Link to={messageHref(item.messageKey, returnTo)}>{item.title}</Link>
              <span className="review-cue"> · Requires review</span>
              <div className="extracted-track" aria-hidden="true">
                <span
                  className={item.kind === "point" ? "extracted-point" : "extracted-interval"}
                  style={{
                    left: `${left}%`,
                    width: item.kind === "point" ? undefined : `${width}%`,
                  }}
                />
              </div>
              <p>
                {item.kind === "point"
                  ? `Point: ${format(timestampFromDate(new Date(a)))}`
                  : `${format(timestampFromDate(new Date(a)))} → ${format(timestampFromDate(new Date(b)))}`}
              </p>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
