import type { MessageRecord } from "../gen/app/v1/models_pb";
import { blankPreparation, type PreparationFields } from "./preparation-format";
import { structuredPayload } from "./structured-message-format";
import { sourceSets } from "./usmtf-sets";

// Temporary identity explicitly requested by the user. Replace through shared Settings (#6).
export const acknowledgementIdentity = { outgoing: "FLEETHACKER", authority: "FLEETHACKER" };
export function referenceDtg(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:00Z$/.test(value)) {
    return "";
  }
  const date = new Date(value);
  if (!Number.isFinite(date.valueOf()) || date.toISOString().replace(".000Z", "Z") !== value) {
    return "";
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getUTCDate())}${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}Z${"JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC".split(" ")[date.getUTCMonth()]}${String(date.getUTCFullYear()).padStart(4, "0")}`;
}
export function acknowledgementDefaults(message: MessageRecord): PreparationFields {
  const payload = structuredPayload(message);
  const text = (key: string) => (typeof payload?.[key] === "string" ? payload[key] : "");
  // F541 REF has minute precision; keep the source instant separately. Seconds do not
  // justify changing its minute or substituting receipt time for an unresolved issue date.
  const issue = text("issued_at");
  const minuteIssue =
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(issue) && Number.isFinite(Date.parse(issue))
      ? issue.replace(/:\d\dZ$/, ":00Z")
      : "";
  const sets = sourceSets(payload) ?? [];
  const contexts = sets.filter((set) => set.set_id === "EXER" || set.set_id === "OPER");
  const context = contexts.length === 1 ? contexts[0] : undefined;
  return {
    ...blankPreparation,
    ...acknowledgementIdentity,
    letter: "A",
    type: text("type"),
    originator: text("originator"),
    serial: text("serial"),
    dtg: referenceDtg(minuteIssue),
    contextKind: context?.set_id ?? "",
    context: context?.fields[0]?.value.trim() ?? "",
  };
}
