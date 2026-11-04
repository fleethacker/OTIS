import moment from "moment-timezone";
import { momentLocalizer } from "react-big-calendar";

export function calendarLocalizer(zone: string) {
  // Scope every Moment call to this calendar, without mutating Moment's global default.
  const zoned = Object.assign(
    (...args: Parameters<typeof moment>) => moment(...args).tz(zone),
    moment
  );
  // String parsing (merge) must interpret civil fields in the display zone, not the host zone.
  const localizer = momentLocalizer(zoned);
  const midnight = (date: Date) => +moment.tz(date, zone).startOf("day");
  return Object.assign(localizer, {
    // Day slots are elapsed minutes. No DST correction: both occurrences of a repeated
    // hour have their own slot and real instant, and spring's missing hour has none.
    getDstOffset: () => 0,
    // Suppress RBC's cosmetic TimeGutter shift to the previous day across DST.
    // Our gutter must show this day's real slots, not an ordinary 24-hour surrogate.
    getTimezoneOffset: () => 0,
    getTotalMin: (start: Date, end: Date) => Math.floor((+end - +start) / 60000),
    getMinutesFromMidnight: (date: Date) => (+date - midnight(date)) / 60000,
    getSlotDate: (date: Date, minutes: number, offset: number) =>
      new Date(midnight(date) + (minutes + offset) * 60000),
    merge: (date: Date, time: Date) => {
      const day = moment.tz(date, zone);
      const clock = moment.tz(time, zone);
      if (day.isSame(clock, "day")) {
        return new Date(+time);
      }
      return moment
        .tz(`${day.format("YYYY-MM-DD")} ${clock.format("HH:mm:ss")}`, "YYYY-MM-DD HH:mm:ss", zone)
        .toDate();
    },
    segmentOffset: 0,
    startAndEndAreDateOnly: (start: Date, end: Date) =>
      [start, end].every((date) => +date === midnight(date)),
  });
}
export const utcLocalizer = calendarLocalizer("UTC");
