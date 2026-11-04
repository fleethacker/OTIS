import type { MessageRecord } from "../gen/app/v1/models_pb";
import { geometry, instant } from "./calendar-time";
import { shipKey, UNASSIGNED } from "./ship-calendars";

export function discover(
  messages: MessageRecord[],
  query: string,
  now: number,
  ships?: Set<string>
) {
  const q = query.trim().toLowerCase();
  const matches = (values: (string | undefined)[]) => values.join("\n").toLowerCase().includes(q);
  const recordReview = new Set<string>();
  const associated = messages.flatMap((message) => {
    const events = message.events.filter((event) => !ships || ships.has(shipKey(event.unit)));
    const eventless = message.events.length === 0 && (!ships || ships.has(UNASSIGNED));
    if (events.length === 0 && !eventless) {
      return [];
    }
    const unresolved = message.events.some((event) => !geometry(event, -8.64e15, 8.64e15));
    const selectedUnresolved = events.some((event) => !geometry(event, -8.64e15, 8.64e15));
    if (!unresolved || selectedUnresolved) {
      recordReview.add(message.sourceMessageId);
    }
    return [
      {
        ...message,
        events,
      },
    ];
  });
  const filtered = associated
    .map((message) => {
      const shared = [message.rawText, message.sourceMessageId];
      return {
        ...message,
        events: message.events.filter((event) =>
          matches([...shared, event.title, event.unit, event.location])
        ),
      };
    })
    .filter(
      (message) =>
        message.events.length > 0 ||
        (message.processingStatus === "needs_review" &&
          recordReview.has(message.sourceMessageId) &&
          matches([message.rawText, message.sourceMessageId, message.subject]))
    );
  const rows = filtered.flatMap((message) => message.events.map((event) => ({ message, event })));
  const timed = rows
    .filter(({ event }) => geometry(event, -8.64e15, 8.64e15))
    .sort((a, b) => instant(a.event.startAt) - instant(b.event.startAt));
  const review = filtered.filter(
    (message) =>
      (message.processingStatus === "needs_review" && recordReview.has(message.sourceMessageId)) ||
      message.events.some((event) => !geometry(event, -8.64e15, 8.64e15))
  );
  return {
    messages: filtered,
    timed,
    upcoming: timed.filter(({ event }) => instant(event.startAt) >= now).slice(0, 5),
    review,
  };
}
