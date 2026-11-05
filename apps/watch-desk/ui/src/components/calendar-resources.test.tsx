import { expect, test } from "bun:test";
import { create } from "@bufbuild/protobuf";
import { MessageRecordSchema } from "../gen/app/v1/models_pb";
import { renderWithProviders } from "../test-utils/render";
import { DayTimeline } from "./day-timeline";
import { inShipColumns, shipResources } from "./calendar-resources";
import { calendarLanes } from "./calendar-layout";
import type { Command } from "./command-roster";
import type { TimelineItem } from "./source-data";

const commands: Command[] = [
  { id: "demo-tern", name: "USNS Tern", shortLabel: "TERN", group: "Fictional", colorIndex: 2, isOwnShip: true },
  { id: "demo-halyard", name: "USS Halyard", shortLabel: "HALYARD", group: "Fictional", colorIndex: 1, isOwnShip: false },
];
const key = "fictional-shared@r1";
const item: TimelineItem = { key: `${key}#point`, messageKey: key, factId: "point", title: "Fictional shared check", commandIds: ["demo-tern", "demo-halyard"], kind: "point", at: "2026-11-05T08:00:00Z", reviewRequired: true };

test("resource projection duplicates only visible explicit assignments and leaves source untouched", () => {
  const input = Object.freeze([Object.freeze({ commandIds: ["demo-tern", "demo-halyard"], at: item.at })]);
  const resources = shipResources(commands, input);
  expect(resources.map((r) => r.id)).toEqual(["unit:demo-tern", "unit:demo-halyard", "unassigned:"]);
  expect(inShipColumns(input, resources).map((r) => r.resourceId)).toEqual(["unit:demo-tern", "unit:demo-halyard"]);
  expect(input).toHaveLength(1);
  const only = shipResources(commands, input, new Set(["unit:demo-halyard"]));
  expect(inShipColumns(input, only)).toHaveLength(1);
  expect(inShipColumns(input, shipResources(commands, input, new Set()))).toHaveLength(0);
  expect(shipResources(commands, [], new Set(["invalid-selection:"]))).toHaveLength(0);
  // Deliberate legacy/adversarial input, not a canonical presentation mock.
  expect(inShipColumns([{ commandIds: [], unit: "demo-tern" }], resources)[0].resourceId).toBe("unassigned:");
  // Parker's lane partition is applied independently to each resource, including points.
  const collisions = calendarLanes([{ event: "first", top: 10, height: 20 }, { event: "second", top: 15, height: 20 }]);
  expect(collisions.map((r) => r.columns)).toEqual([2, 2]);
  expect(calendarLanes([{ event: "other ship", top: 15, height: 20 }])[0].columns).toBe(1);
});

test("Day resource links duplicate shared points; Combined and Week remain deduplicated", () => {
  const message = create(MessageRecordSchema, { sourceMessageId: key });
  const common = {
    commands, messages: [message], sourceItems: [item], interval: 60,
    from: Date.parse("2026-11-05T00:00:00Z"), to: Date.parse("2026-11-06T00:00:00Z"),
    returnTo: '/calendar?date=2026-11-05&shipLayout=side&ships=%5B%22unit%3Ademo-tern%22%2C%22unit%3Ademo-halyard%22%5D',
  };
  const side = renderWithProviders(<DayTimeline {...common} shipLayout="side" selectedShips={new Set(["unit:demo-tern", "unit:demo-halyard"])} />);
  const links = side.getAllByRole("link", { name: `${item.title}, source record` });
  expect(links).toHaveLength(2);
  for (const link of links) {
    expect(link.textContent).toBe(item.title);
    const url = new URL(link.getAttribute("href")!, "http://localhost");
    expect(url.searchParams.get("record")).toBe(key);
    expect(url.searchParams.get("returnTo")).toBe(common.returnTo);
  }
  expect(side.getByTitle("USNS Tern")).toHaveClass("resource-ship-chip");
  expect(side.getByTitle("USS Halyard")).toHaveClass("resource-ship-chip");
  expect((side.getByTitle("USNS Tern") as HTMLElement).style.backgroundColor).not.toBe((side.getByTitle("USS Halyard") as HTMLElement).style.backgroundColor);
  const fills = links.map((link) => (link.closest(".rbc-event") as HTMLElement).style.getPropertyValue("--ship-color"));
  expect(new Set(fills).size).toBe(2);
  side.unmount();
  const combined = renderWithProviders(<DayTimeline {...common} shipLayout="combined" />);
  expect(combined.getAllByRole("link", { name: `${item.title}, source record` })).toHaveLength(1);
  combined.unmount();
  const week = renderWithProviders(<DayTimeline {...common} view="week" shipLayout="side" from={Date.parse("2026-11-01T00:00:00Z")} to={Date.parse("2026-11-08T00:00:00Z")} />);
  expect(week.getAllByRole("button", { name: `${item.title}, event details` })).toHaveLength(1);
  expect(week.container.querySelector(".ship-calendar-resources")).toBeNull();
  week.unmount();
  const none = renderWithProviders(<DayTimeline {...common} shipLayout="side" selectedShips={new Set()} />);
  expect(none.queryByRole("link")).toBeNull();
  expect(none.getByText(/No valid ship calendars selected/)).toBeTruthy();
});
