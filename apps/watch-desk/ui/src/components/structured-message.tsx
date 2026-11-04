import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import type { MessageRecord } from "../gen/app/v1/models_pb";
import { useDisplayTime } from "./display-time";
import { isObject, structuredPayload, type Fields, type Value } from "./structured-message-format";

// Registration controls grouping and labels, never filters the source. All unregistered keys
// flow into Additional fields at every object level; new activity types need no bespoke card.
const sections: Record<string, string[]> = {
  "Message metadata": [
    "type",
    "subject",
    "originator",
    "serial",
    "id",
    "revision",
    "status",
    "issued_at",
    "expires_at",
    "command_ids",
  ],
  "Security metadata": ["security"],
  "Review flags": ["review_flags"],
  Periods: ["periods"],
  Frequencies: ["frequencies"],
  Activities: ["activities"],
  Contacts: ["contacts"],
};
const registered = new Set(Object.values(sections).flat());
const knownFields = new Set([
  "id",
  "revision",
  "type",
  "subject",
  "originator",
  "serial",
  "status",
  "issued_at",
  "expires_at",
  "command_ids",
  "policy",
  "classification",
  "release_to",
  "security",
  "review_flags",
  "start_at",
  "end_at",
  "end_status",
  "start_status",
  "hz",
  "upper_hz",
  "plan",
  "designator",
  "channel",
  "emission",
  "usage",
  "scope",
  "task_type",
  "description",
  "start_time",
  "end_time",
  "variant",
  "circuits",
  "participants",
  "at",
  "coordination",
  "material",
  "line",
  "mode",
  "report",
  "responsible_party",
  "as_of_time",
  "as_of_status",
  "deadline_time",
  "deadline_status",
  "delivery",
  "as_of_label",
  "deadline_label",
  "time",
  "time_status",
  "equipment",
  "name",
  "position",
  "unit",
  "channels",
  "location",
  "role",
  "value",
  "course",
]);
const labels: Record<string, string> = {
  id: "Source ID",
  revision: "Source revision",
  hz: "Frequency",
  upper_hz: "Upper range",
  status: "Status",
  issued_at: "Issued at",
  expires_at: "Expires at",
};
function label(key: string) {
  return labels[key] ?? key.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}
function DataValue({ value, field = "" }: { value: Value | undefined; field?: string }) {
  const { format } = useDisplayTime();
  if (value === undefined) {
    return <span className="feature-note">Not supplied</span>;
  }
  if (value === null) {
    return <span className="feature-note">Unavailable (null)</span>;
  }
  if (Array.isArray(value)) {
    return value.length > 0 ? (
      <ol className="structured-items">
        {value.map((item, index) => (
          <li key={index}>
            <DataValue value={item} />
          </li>
        ))}
      </ol>
    ) : (
      <span className="feature-note">None supplied (empty list)</span>
    );
  }
  if (isObject(value)) {
    return Object.keys(value).length > 0 ? (
      <ObjectFields value={value} />
    ) : (
      <span>Empty object</span>
    );
  }
  if (typeof value === "string") {
    // Only complete offset-bearing instants are display-zone converted. Fragments stay literal.
    if (
      /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value) &&
      Number.isFinite(Date.parse(value))
    ) {
      return <time dateTime={value}>{format(timestampFromDate(new Date(value)))}</time>;
    }
    return (
      <span className={/status|flags/.test(field) ? "structured-attention" : undefined}>
        {value === "" ? 'Empty string ("")' : value}
      </span>
    );
  }
  return (
    <span>
      {String(value)}
      {typeof value === "number" && (field === "hz" || field === "upper_hz") ? " Hz" : ""}
    </span>
  );
}
function FieldList({ entries }: { entries: [string, Value | undefined][] }) {
  return (
    <dl className="structured-fields">
      {entries.map(([key, value]) => (
        <div key={key}>
          <dt>{label(key)}</dt>
          <dd>
            <DataValue value={value} field={key} />
          </dd>
        </div>
      ))}
    </dl>
  );
}
function ObjectFields({ value }: { value: Fields }) {
  const entries = Object.entries(value);
  const known = entries.filter(([key]) => knownFields.has(key));
  const extra = entries.filter(([key]) => !knownFields.has(key));
  return (
    <>
      <FieldList entries={known} />
      {extra.length > 0 && (
        <section className="structured-extra">
          <h4>Additional fields</h4>
          <FieldList entries={extra} />
        </section>
      )}
    </>
  );
}
export function StructuredMessage({ message }: { message: MessageRecord }) {
  const payload = structuredPayload(message);
  if (!payload) {
    return (
      <p role="alert">Structured payload unavailable or invalid. Legacy fields remain below.</p>
    );
  }
  const extra = Object.entries(payload).filter(([key]) => !registered.has(key));
  return (
    <div className="structured-message">
      <p className="feature-note">
        Structured source data, not original raw USMTF. Periods and activities are not confirmed
        calendar events. Security metadata is supplied, not authorization or validated markings.
      </p>
      {Object.entries(sections).map(([title, keys]) => (
        <section className="structured-section" key={title} aria-label={title}>
          <h3>{title}</h3>
          <FieldList
            entries={keys.map((key) => [
              key,
              Object.prototype.hasOwnProperty.call(payload, key) ? payload[key] : undefined,
            ])}
          />
        </section>
      ))}
      {extra.length > 0 && (
        <section className="structured-section">
          <h3>Additional fields</h3>
          <FieldList entries={extra} />
        </section>
      )}
    </div>
  );
}
