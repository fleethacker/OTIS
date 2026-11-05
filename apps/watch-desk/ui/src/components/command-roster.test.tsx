import "../route-registry";
import { expect, spyOn, test } from "bun:test";
import { act, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useLocation } from "react-router-dom";
import { create } from "@bufbuild/protobuf";
import { MessageRecordSchema } from "../gen/app/v1/models_pb";
import { renderWithProviders } from "../test-utils/render";
import Calendar from "../pages/calendar";
import { DayTimeline } from "./day-timeline";
import { commandKeys, readCommands, type CommandRoster } from "./command-roster";

const roster: CommandRoster = {
  commands: [
    { id: "demo-meridian", name: "USS Meridian", shortLabel: "MERIDIAN", group: "Fictional group", colorIndex: 0, isOwnShip: true },
    { id: "demo-halyard", name: "USS Halyard", shortLabel: "HALYARD", group: "Fictional group", colorIndex: 1, isOwnShip: false },
  ],
  source: "backend/config/watchdesk-demo.json", version: "fictional-test", provenance: "Fictional demo", assignmentEnabled: true,
};
function Location() { return <output data-testid="location">{useLocation().search}</output>; }

test("sidebar sends explicit IDs/none through the existing JSON URL; Show preserves Week", async () => {
  const requests: Record<string, unknown>[] = [];
  const fetch = spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    if (String(url).endsWith("/commands/list")) return Response.json(roster);
    if (!String(url).endsWith("/messages/timeline")) throw new Error("Unexpected test request");
    requests.push(JSON.parse(String(init?.body)));
    return Response.json({ messages: [], meta: { timelineItems: [], reviewItems: [], windowLimited: false } });
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = renderWithProviders(<QueryClientProvider client={client}><Calendar /><Location /></QueryClientProvider>, {
    route: "/calendar?date=2026-11-05&view=week&layout=expanded",
  });
  try {
    await waitFor(() => expect(view.getByRole("button", { name: "Only USS Meridian" })).toBeTruthy());
    await act(async () => { fireEvent.click(view.getByRole("button", { name: "Only USS Meridian" })); });
    await waitFor(() => expect(requests.some((r) => JSON.stringify(r.filters).includes('"commandIds":["demo-meridian"]'))).toBe(true));
    let params = new URLSearchParams(view.getByTestId("location").textContent!);
    expect(JSON.parse(params.get("ships")!)).toEqual(["unit:demo-meridian"]);
    expect(params.get("layout")).toBe("expanded");
    await act(async () => { fireEvent.click(view.getByRole("button", { name: "Clear all" })); });
    await waitFor(() => expect(view.getByText("No ships selected. Choose a ship or Unassigned.")).toBeTruthy());
    expect(requests.some((r) => (r.filters as { noCommands?: boolean }).noCommands)).toBe(false);
    expect(view.getByText("No ships selected; review was not queried.")).toBeTruthy();
    expect(view.queryByText(/No unresolved times/)).toBeNull();
    await waitFor(() => expect(client.isFetching()).toBe(0));
    expect(new URLSearchParams(view.getByTestId("location").textContent!).get("ships")).toBe("[]");
    await act(async () => { fireEvent.click(view.getByRole("button", { name: "Show all ships and clear search" })); });
    await waitFor(() => expect(client.isFetching()).toBe(0));
    params = new URLSearchParams(view.getByTestId("location").textContent!);
    expect(params.has("ships")).toBe(false);
    expect(params.get("view")).toBe("week");
  } finally { view.unmount(); client.clear(); fetch.mockRestore(); }
});

test("explicit none has the same unqueried empty state in every layout", async () => {
  const fetch = spyOn(globalThis, "fetch").mockImplementation(async (url) => {
    if (!String(url).endsWith("/commands/list")) throw new Error("Empty selection must not query messages");
    return Response.json(roster);
  });
  try {
    for (const suffix of ["view=day", "view=day&shipLayout=side", "view=week", "view=month"]) {
      const view = renderWithProviders(<Calendar />, { route: `/calendar?date=2026-11-05&ships=%5B%5D&${suffix}` });
      await waitFor(() => expect(view.getByRole("button", { name: "Only USS Meridian" })).toBeTruthy());
      expect(view.getByText("No ships selected. Choose a ship or Unassigned.")).toBeTruthy();
      expect(view.queryByText(/No unresolved times/)).toBeNull();
      view.unmount();
    }
  } finally { fetch.mockRestore(); }
});

test("canonical chips use all explicit command IDs, never unit or sender", () => {
  expect(commandKeys([])).toEqual(["unassigned:"]);
  expect(commandKeys(["demo-tern", "demo-halyard", "demo-tern"])).toEqual(["unit:demo-tern", "unit:demo-halyard"]);
  const key = "fictional-only@r1";
  const message = create(MessageRecordSchema, { sourceMessageId: key, sender: "USS Meridian", events: [{ sourceEventId: "point" }] });
  const view = renderWithProviders(<DayTimeline
    messages={[message]} commands={roster.commands}
    sourceItems={[{ key: `${key}#point`, messageKey: key, factId: "point", commandIds: [], kind: "point", at: "2026-11-05T08:00:00Z", title: "Fictional check", reviewRequired: true }]}
    from={Date.parse("2026-11-05T00:00:00Z")} to={Date.parse("2026-11-06T00:00:00Z")} interval={60} returnTo="/calendar"
  />);
  const card = view.getByRole("link", { name: "Fictional check, source record" });
  expect(card.textContent).toBe("Fictional check");
  expect(card.title).toContain("Applicability: Unassigned");
  expect(card.title).not.toContain("Reported unit");
  expect(card.closest(".calendar-event-copy")?.textContent).toContain("REVIEW");
  expect(view.queryByText("MERIDIAN")).toBeNull();
  expect(message.events[0].startAt).toBeUndefined(); // presentation must not mutate the cached message
});

test("canonical sole-command unit is applicability, not a contradictory reported-unit warning", () => {
  const key = "fictional-assigned@r1";
  const message = create(MessageRecordSchema, { sourceMessageId: key, events: [{ sourceEventId: "assigned", unit: "demo-meridian" }] });
  const view = renderWithProviders(<DayTimeline messages={[message]} commands={roster.commands}
    sourceItems={[{ key: `${key}#assigned`, messageKey: key, factId: "assigned", commandIds: ["demo-meridian"], kind: "point", at: "2026-11-05T08:00:00Z", title: "Assigned check", reviewRequired: true }]}
    from={Date.parse("2026-11-05T00:00:00Z")} to={Date.parse("2026-11-06T00:00:00Z")} interval={60} returnTo="/calendar" />);
  const card = view.getByRole("link", { name: "Assigned check, source record" });
  expect(card.title).toContain("Applicability: USS Meridian");
  expect(card.title).not.toContain("Reported unit");
});

test("roster rejects duplicate identities and never substitutes demo data on failure", async () => {
  const fetch = spyOn(globalThis, "fetch").mockImplementation(async () => Response.json({ ...roster, commands: [roster.commands[0], roster.commands[0]] }));
  try { await expect(readCommands()).rejects.toThrow("duplicate"); }
  finally { fetch.mockRestore(); }
});
