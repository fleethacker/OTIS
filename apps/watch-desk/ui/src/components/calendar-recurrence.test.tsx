import { create } from "@bufbuild/protobuf";
import { expect, test } from "bun:test";
import { fireEvent } from "@testing-library/react";
import { MessageRecordSchema } from "../gen/app/v1/models_pb";
import { renderWithProviders } from "../test-utils/render";
import { DayTimeline } from "./day-timeline";
import type { TimelineItem } from "./source-data";
import type { Command } from "./command-roster";
const key = "fictional-recurring@r1";
const message = create(MessageRecordSchema, { sourceMessageId: key });
const description = "Daily at 0800Z and 2000Z, from 05 NOV 2026 through 08 NOV 2026";
const items: TimelineItem[] = ["08", "20"].map((hour) => {
  const at = `2026-11-05T${hour}:00:00Z`, occurrenceId = `r1@${at}`;
  return { key: `${key}#${occurrenceId}`, messageKey: key, factId: occurrenceId, sourceFactId: "r1", title: "Recurring check", kind: "point", at, reviewRequired: true, commandIds: ["demo-tern", "demo-halyard"],
    recurrence: { ruleFactId: "r1", occurrenceId, rule: "FREQ=DAILY;BYHOUR=8,20;BYMINUTE=0", description, ongoing: false } };
});
const commands: Command[] = [
  { id: "demo-tern", name: "USNS Tern", shortLabel: "TERN", group: "Fictional", colorIndex: 2, isOwnShip: false },
  { id: "demo-halyard", name: "USS Halyard", shortLabel: "HALYARD", group: "Fictional", colorIndex: 1, isOwnShip: false },
];
for (const mode of ["day", "week", "month", "side"] as const) {
  test(`recurrence identity, marker and rule details survive ${mode} presentation`, () => {
    const from = mode === "day" || mode === "side" ? "2026-11-05T00:00:00Z" : "2026-11-01T00:00:00Z";
    const to = mode === "month" ? "2026-12-01T00:00:00Z" : mode === "week" ? "2026-11-08T00:00:00Z" : "2026-11-06T00:00:00Z";
    // Month overflow/show-more polish is owned separately; one occurrence proves its renderer.
    const sourceItems = mode === "month" ? items.slice(0, 1) : items;
    const view = renderWithProviders(<DayTimeline messages={[message]} sourceItems={sourceItems} commands={commands}
      from={Date.parse(from)} to={Date.parse(to)}
      view={mode === "side" ? "day" : mode} shipLayout={mode === "side" ? "side" : "combined"}
      selectedShips={new Set(["unit:demo-tern", "unit:demo-halyard"])} interval={60} returnTo="/calendar?date=2026-11-05" />);
    const targets = [...view.container.querySelectorAll<HTMLElement>("[data-calendar-event]")];
    expect(targets.length).toBe(mode === "month" ? 1 : mode === "side" ? 4 : 2);
    expect(new Set(targets.map((node) => node.dataset.calendarEvent)).size).toBe(targets.length);
    for (const target of targets) {
      expect(target.textContent).toContain("↻"); expect(target.title).toContain(description);
      expect(target.title).toContain("Audited rule fact: r1"); expect(target.title).not.toContain("End:");
    }
    if (mode === "week") {
      fireEvent.click(view.getByRole("button", { name: "Browse 2 events in window" }));
      // A repeated series has no legacy numeric event ID; the index must still have unique keys.
      const choices = [...view.container.querySelectorAll(".week-details-row")];
      expect(choices).toHaveLength(2);
      fireEvent.click(choices[0]);
      expect(view.container.querySelector(".week-details")?.textContent).not.toContain("r1@");
    }
    expect(message.events).toHaveLength(0);
    view.unmount();
  });
}
