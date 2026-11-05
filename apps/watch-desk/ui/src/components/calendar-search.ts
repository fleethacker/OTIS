import type { MessageRecord } from "../gen/app/v1/models_pb";
import type { TimelineItem } from "./source-data";

/** Local title hits must not depend on narrative passage publication/embedding. */
export function calendarSearch(items: TimelineItem[] | undefined, messages: MessageRecord[], query: string, keywordKeys: Set<string>) {
  if (items === undefined || !query.trim()) return items;
  const terms = query.toLocaleLowerCase().trim().split(/\s+/);
  const headers = new Map(messages.map((m) => [m.sourceMessageId, `${m.subject ?? ""} ${m.sender ?? ""} ${m.sourceMessageId}`]));
  return items.filter((item) => keywordKeys.has(item.messageKey) || terms.every((term) =>
    `${item.title} ${headers.get(item.messageKey) ?? ""}`.toLocaleLowerCase().includes(term)
  ));
}
