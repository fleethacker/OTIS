import type { MessageRecord } from "../gen/app/v1/models_pb";

export type Value = null | boolean | number | string | Value[] | { [key: string]: Value };
export type Fields = Record<string, Value>;
export const isObject = (value: Value): value is Fields =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export function structuredPayload(message: MessageRecord): Fields | undefined {
  if (message.structuredPayloadJson === undefined) {
    return;
  }
  try {
    const value = JSON.parse(message.structuredPayloadJson) as Value;
    return isObject(value) ? value : undefined;
  } catch {
    return;
  }
}

export function messageTitle(message: MessageRecord) {
  const payload = structuredPayload(message);
  if (payload) {
    if (typeof payload.subject === "string" && payload.subject.trim().length > 0) {
      return payload.subject;
    }
    return [
      typeof payload.type === "string" ? payload.type : "Message type unavailable",
      payload.serial,
    ]
      .filter((value): value is string => typeof value === "string" && value.length > 0)
      .join(" · ");
  }
  if (message.subject !== undefined && message.subject.length > 0) {
    return message.subject;
  }
  const eventTitle = message.events[0]?.title ?? "";
  return eventTitle.length > 0 ? eventTitle : "Subject unavailable";
}

export function structuredIdentifiers(message: MessageRecord) {
  const payload = structuredPayload(message);
  return payload
    ? [
        payload.type,
        payload.originator,
        payload.serial,
        payload.status,
        ...(Array.isArray(payload.review_flags) ? payload.review_flags : []),
      ]
        .filter((value): value is string => typeof value === "string")
        .join(" · ")
    : "";
}
