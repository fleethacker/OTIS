import { calendarReturn } from "./calendar-links";
import { civilDate } from "./display-time";
import type { AddedEvent, WatchChange } from "./watch-changes";

export function watchPanelHref(returnTo: string) {
  const params = new URLSearchParams(calendarReturn(returnTo).split("?")[1] ?? "");
  const since = params.get("since");
  params.set("since", since?.startsWith("closed:") ? since.slice(7) : since ?? "session");
  return `/calendar?${params}#since-last-watch`;
}

export function addedEventInstant(event: AddedEvent) {
  const value = event.at ?? event.start;
  return value && Number.isFinite(Date.parse(value)) ? value : undefined;
}
export function showOnCalendar(row: WatchChange, returnTo: string, zone: string) {
  const event = row.addedEvents?.find((item) => addedEventInstant(item));
  const at = event && addedEventInstant(event);
  if (!row.messageKey || !event || !at) return undefined;
  const params = new URLSearchParams(calendarReturn(returnTo).split("?")[1] ?? "");
  params.set("date", civilDate(new Date(at), zone));
  params.set("view", "day");
  params.set("focusMessage", row.messageKey);
  params.set("focusAt", at);
  params.delete("focusFact");
  if (event.factId) params.set("focusFact", event.factId);
  const ids = event.commandIds ?? row.commandIds;
  params.set("ships", JSON.stringify(ids.length ? ids.map((id) => `unit:${id}`) : ["unassigned:"]));
  params.delete("q"); params.delete("dataset");
  return `/calendar?${params}`;
}
