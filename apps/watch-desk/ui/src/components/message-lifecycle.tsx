import { Notice } from "./ui";
import moment from "moment-timezone";
import { useDisplayTime } from "./display-time";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { MessageRecord, MessageLifecycleEntry } from "../gen/app/v1/models_pb";
import { structuredPayload } from "./structured-message-format";

const labels: Record<string, string | undefined> = {
  issued: "Issued",
  ingested: "Ingested",
  parsed: "Parsed",
  indexed: "Indexed",
  received_again: "Received again",
  ingest_failed: "Ingestion failed",
  acknowledgement_sent: "Acknowledgement sent",
};
function time(entry: MessageLifecycleEntry, zone: string) {
  if (!entry.recordedAt) {
    return <span className="lifecycle-time">Time unavailable</span>;
  }
  const at = timestampDate(entry.recordedAt).toISOString();
  return (
    <time className="lifecycle-time" dateTime={at}>
      {moment
        .tz(at, zone)
        .format(zone === "UTC" ? "YYYY-MM-DD HH:mm:ss[Z]" : "YYYY-MM-DD HH:mm:ss z")}
    </time>
  );
}
export function MessageLifecycle({ message }: { message: MessageRecord }) {
  const { zone } = useDisplayTime();
  const payload = structuredPayload(message);
  const issued = message.lifecycleEntries.filter((entry) => entry.milestone === "issued");
  const rest = message.lifecycleEntries
    .filter((entry) => entry.milestone !== "issued")
    .sort((a, b) => {
      if (!a.recordedAt) {
        return b.recordedAt ? 1 : 0;
      }
      if (!b.recordedAt) {
        return -1;
      }
      const seconds = Number(a.recordedAt.seconds - b.recordedAt.seconds);
      return seconds !== 0 ? seconds : a.recordedAt.nanos - b.recordedAt.nanos;
    });
  const entries = [...issued, ...rest];
  return (
    <section aria-label="Message lifecycle">
      {payload?.lifecycle_state === "unavailable" && (
        <Notice role="alert" tone="error">
          Ingestion history unavailable.
        </Notice>
      )}
      <ol className="message-vertical-timeline">
        {issued.length === 0 && (
          <li>
            <strong>Issued</strong>
            <span className="lifecycle-time">Time unavailable</span>
          </li>
        )}
        {entries.map((entry) => (
          <li key={entry.id} data-failed={entry.milestone === "ingest_failed"}>
            <strong>{labels[entry.milestone] ?? entry.milestone}</strong>
            {time(entry, zone)}
            {entry.detail !== "" && (
              <span className="lifecycle-detail">{entry.detail.replace(/_/g, " ")}</span>
            )}
          </li>
        ))}
        {!entries.some((entry) => entry.milestone === "ingested") && (
          <li>
            <strong>Ingested</strong>
            <span className="lifecycle-time">Time unavailable</span>
          </li>
        )}
        {!entries.some((entry) => entry.milestone === "acknowledgement_sent") && (
          <li data-pending="true">
            <strong>Acknowledgement sent</strong>
            <span className="status-pill">Pending</span>
          </li>
        )}
      </ol>
      {payload?.lifecycle_limited === true && <p className="text-sm">History limit reached.</p>}
    </section>
  );
}
