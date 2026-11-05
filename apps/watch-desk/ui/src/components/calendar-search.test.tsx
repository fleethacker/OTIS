import "../route-registry";
import { expect, spyOn, test } from "bun:test";
import { waitFor } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { MessageRecordSchema } from "../gen/app/v1/models_pb";
import { renderWithProviders } from "../test-utils/render";
import Calendar from "../pages/calendar";
import { calendarSearch } from "./calendar-search";
import { messageSearchState } from "./message-search-state";
import type { TimelineItem } from "./source-data";

const keys = ["corvina@fictional-r1", "unassigned@fictional-r1", "tern@fictional-r1"];
const messages = keys.map((sourceMessageId) => create(MessageRecordSchema, { sourceMessageId }));
const items: TimelineItem[] = keys.map((messageKey, i) => ({ key: `${messageKey}#a1`, messageKey, title: i === 2 ? "Replenishment" : "communications check", kind: "point", at: "2026-11-05T08:00:00Z", reviewRequired: true }));

test("all returned title hits survive absent passages; semantic-only hits are never substituted", () => {
  expect(calendarSearch(items, messages, "communications", new Set())?.map((i) => i.messageKey)).toEqual(keys.slice(0, 2));
  expect(calendarSearch(items, messages, "communications", new Set([keys[2]]))).toHaveLength(3);
  expect(calendarSearch(items, messages, "radio rehearsal", new Set())).toEqual([]);
  expect(calendarSearch(undefined, messages, "radio", new Set())).toBeUndefined();
  expect(messageSearchState(new URLSearchParams(), "radio rehearsal").request.mode).toBe("keyword");
  expect(messageSearchState(new URLSearchParams("mode=hybrid"), "radio rehearsal").request.mode).toBe("hybrid");
});

test("Calendar requests unfiltered timeline plus keyword search and discloses executed mode and limits", async () => {
  const requests: { operation: string; body: Record<string, unknown> }[] = [];
  const fetch = spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    const operation = String(url).split("/").pop()!;
    requests.push({ operation, body: JSON.parse(String(init?.body)) });
    if (operation === "list") return Response.json({ commands: [], source: "fictional", version: "test", provenance: "fictional", assignmentEnabled: false });
    if (operation === "search") return Response.json({ messages: [], meta: { executedMode: "keyword", nextPageToken: "bounded-page" } });
    return Response.json({ messages: keys.map((sourceMessageId) => ({ sourceMessageId })), meta: { timelineItems: items, reviewItems: [] } });
  });
  const view = renderWithProviders(<Calendar />, { route: "/calendar?date=2026-11-05&q=communications" });
  try {
    await waitFor(() => expect(view.getAllByRole("link", { name: "communications check, source record" })).toHaveLength(2));
    await waitFor(() => expect(view.getByText(/Executed passage search: keyword/)).toBeTruthy());
    expect(view.getByText(/Only the returned keyword page/)).toBeTruthy();
    expect(requests.find((r) => r.operation === "timeline")?.body.query).toBe("");
    expect(requests.find((r) => r.operation === "search")?.body.mode).toBe("keyword");
    expect(view.getByRole("link", { name: "Find related messages (hybrid)" }).getAttribute("href")).toContain("mode=hybrid");
  } finally { view.unmount(); fetch.mockRestore(); }
});
