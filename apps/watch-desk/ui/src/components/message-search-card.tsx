import moment from "moment-timezone";
import type { MessageRecord } from "../gen/app/v1/models_pb";
import type { MessageHeader } from "./source-data";
import { OptaskIcon } from "./optask-icons";

export function MessageSearchCard({
  message,
  header,
  selected,
  onSelect,
}: {
  message: MessageRecord;
  header?: MessageHeader;
  selected: boolean;
  onSelect: () => void;
}) {
  const type = header?.type ?? "Type unavailable";
  const subjectValue = message.subject?.trim() ?? "";
  const subject = subjectValue.length > 0 ? subjectValue : "Subject unavailable";
  const originator = header?.originator ?? "Originator unavailable";
  const issue =
    header?.issuedAt === undefined ? undefined : moment.utc(header.issuedAt, moment.ISO_8601, true);
  const issuedAt =
    issue?.isValid() === true ? issue.format("DD MMM YYYY HHmmss[Z]").toUpperCase() : undefined;
  return (
    <button className="record-entry" aria-pressed={selected} onClick={onSelect}>
      <span className="record-card-heading">
        <OptaskIcon type={header?.type} />
        <span className="record-card-type" title={type}>
          {type}
        </span>
        <strong className="record-card-subject" title={subject}>
          {subject}
        </strong>
      </span>
      <span className="record-card-metadata">
        <span className="record-card-originator" title={originator}>
          {originator}
        </span>
        {issuedAt === undefined ? (
          <span>Issue time unavailable</span>
        ) : (
          <time dateTime={header?.issuedAt} title={`Issued ${issuedAt}`}>
            {issuedAt}
          </time>
        )}
      </span>
    </button>
  );
}
