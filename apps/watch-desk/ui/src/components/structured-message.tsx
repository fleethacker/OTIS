import type { ReactNode } from "react";
import type { MessageRecord } from "../gen/app/v1/models_pb";
import { CasualtySummary } from "./casualty-summary";
import { structuredPayload } from "./structured-message-format";
import {
  sourceSets,
  setFieldLabel,
  setFullName,
  type SetField,
  type SourceSet,
} from "./usmtf-sets";

export function UsmtfSetCard({
  name,
  title,
  profile,
  children,
}: {
  name: string;
  title?: string;
  profile?: string;
  children: ReactNode;
}) {
  const fullName = setFullName(name, profile);
  return (
    <section
      className={`usmtf-set-card usmtf-set-${name.toLowerCase()}`}
      aria-label={`${name}${title !== undefined && title !== "" ? ` — ${title}` : ""}`}
    >
      <header>
        <h3>
          {name}
          {fullName !== undefined && fullName !== name ? ` - ${fullName}` : ""}
        </h3>
        {title !== undefined && title !== "" && <h4>{title}</h4>}
      </header>
      {children}
    </section>
  );
}
function Fields({
  fields,
  set,
  examples,
  profile,
}: {
  fields: SetField[];
  set: string;
  examples: boolean | undefined;
  profile?: string;
}) {
  return (
    <div className="usmtf-set-fields">
      {fields.map((field, index) => {
        const label = setFieldLabel(set, field.position, examples, field.value, profile);
        return label !== undefined ? (
          <dl key={index}>
            <dt>{label}</dt>
            <dd>{field.value}</dd>
          </dl>
        ) : (
          <p key={index} className="usmtf-source-value">
            {field.value}
          </p>
        );
      })}
    </div>
  );
}
function ColumnarSet({ set }: { set: SourceSet }) {
  return (
    <div className="usmtf-table-scroll">
      <table className="table table-xs">
        <tbody>
          {set.rows.map((row, index) => (
            <tr key={index}>
              {row.fields.map((field, j) => (
                <td key={j}>{field.value}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function SetCard({ set, examples, profile }: { set: SourceSet; examples: boolean | undefined; profile?: string }) {
  const { set_id: name, fields } = set;
  if (name === "GENTEXT") {
    return (
      <UsmtfSetCard name={name} title={fields[0]?.value} profile={profile}>
        {fields.slice(1).map((field, index) => (
          <p className="usmtf-narrative" key={index}>
            {field.value}
          </p>
        ))}
      </UsmtfSetCard>
    );
  }
  if (name === "AMPN" && (profile === "usmtf-2003-moverep-v1" || profile === "observed-moverep-b10112-v1")) {
    return (
      <UsmtfSetCard name={name} profile={profile}>
        <Fields fields={fields} set={name} examples={examples} profile={profile} />
      </UsmtfSetCard>
    );
  }
  if (["AMPN", "NARR", "RMKS"].includes(name)) {
    return (
      <UsmtfSetCard name={name} profile={profile}>
        {fields.map((field, index) => (
          <p className="usmtf-narrative" key={index}>
            {field.value}
          </p>
        ))}
      </UsmtfSetCard>
    );
  }
  return (
    <UsmtfSetCard name={name} profile={profile}>
      <Fields fields={fields} set={name} examples={examples} profile={profile} />
      {set.rows.length > 0 && <ColumnarSet set={set} />}
    </UsmtfSetCard>
  );
}
export function StructuredMessage({ message }: { message: MessageRecord }) {
  const payload = structuredPayload(message);
  const sets = sourceSets(payload);
  if (sets === undefined || sets.length === 0) {
    return (
      <>
        <CasualtySummary message={message} />
        <p className="text-sm">Parsed sets unavailable.</p>
      </>
    );
  }
  const examples =
    payload?.source_profile === "observed-optask-extensions-v1" ||
    payload?.source_profile === "observed-casrep-b10112-v1"
      ? true
      : payload?.source_profile === "usmtf-2003-subset-v1" ||
          payload?.source_profile === "usmtf-2003-casrep-v1" ||
          payload?.source_profile === "usmtf-2003-moverep-v1" ||
          payload?.source_profile === "observed-moverep-b10112-v1"
        ? false
        : undefined;
  return (
    <div className="usmtf-set-list">
      <CasualtySummary message={message} />
      {sets.map((set, index) => (
        <SetCard key={index} set={set} examples={examples} profile={typeof payload?.source_profile === "string" ? payload.source_profile : undefined} />
      ))}
    </div>
  );
}
