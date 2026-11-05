import type { ReactNode } from "react";
import type { MessageRecord } from "../gen/app/v1/models_pb";
import { structuredPayload } from "./structured-message-format";
import { SignalHeading } from "./signal-flag";
import { signalLetters, type SignalLetter } from "./signal-flag-alphabet";
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
  flag,
  children,
}: {
  name: string;
  title?: string;
  flag: SignalLetter;
  children: ReactNode;
}) {
  const fullName = setFullName(name);
  return (
    <section
      className={`usmtf-set-card usmtf-set-${name.toLowerCase()}`}
      aria-label={`${name}${title !== undefined && title !== "" ? ` — ${title}` : ""}`}
    >
      <header>
        <SignalHeading letter={flag}>
          {name}
          {fullName !== undefined ? ` - ${fullName}` : ""}
        </SignalHeading>
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
}: {
  fields: SetField[];
  set: string;
  examples: boolean | undefined;
}) {
  return (
    <div className="usmtf-set-fields">
      {fields.map((field, index) => {
        const label = setFieldLabel(set, field.position, examples, field.value);
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
function SetCard({
  set,
  examples,
  flag,
}: {
  set: SourceSet;
  examples: boolean | undefined;
  flag: SignalLetter;
}) {
  const { set_id: name, fields } = set;
  if (name === "GENTEXT") {
    return (
      <UsmtfSetCard name={name} title={fields[0]?.value} flag={flag}>
        {fields.slice(1).map((field, index) => (
          <p className="usmtf-narrative" key={index}>
            {field.value}
          </p>
        ))}
      </UsmtfSetCard>
    );
  }
  if (["AMPN", "NARR", "RMKS"].includes(name)) {
    return (
      <UsmtfSetCard name={name} flag={flag}>
        {fields.map((field, index) => (
          <p className="usmtf-narrative" key={index}>
            {field.value}
          </p>
        ))}
      </UsmtfSetCard>
    );
  }
  return (
    <UsmtfSetCard name={name} flag={flag}>
      <Fields fields={fields} set={name} examples={examples} />
      {set.rows.length > 0 && <ColumnarSet set={set} />}
    </UsmtfSetCard>
  );
}
export function StructuredMessage({ message }: { message: MessageRecord }) {
  const payload = structuredPayload(message);
  const sets = sourceSets(payload);
  if (sets === undefined || sets.length === 0) {
    return <p className="text-sm">Parsed sets unavailable.</p>;
  }
  const examples =
    payload?.source_profile === "observed-optask-extensions-v1"
      ? true
      : payload?.source_profile === "usmtf-2003-subset-v1"
        ? false
        : undefined;
  return (
    <div className="usmtf-set-list">
      {sets.map((set, index) => (
        <SetCard
          key={index}
          set={set}
          examples={examples}
          flag={signalLetters[index % signalLetters.length]}
        />
      ))}
    </div>
  );
}
