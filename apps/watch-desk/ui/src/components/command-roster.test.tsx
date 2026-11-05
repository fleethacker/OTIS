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
    await waitFor(() => expect(requests.some((r) => (r.filters as { noCommands?: boolean }).noCommands)).toBe(true));
    await waitFor(() => expect(client.isFetching()).toBe(0));
    expect(new URLSearchParams(view.getByTestId("location").textContent!).get("ships")).toBe("[]");
    await act(async () => { fireEvent.click(view.getByRole("button", { name: "Show all ships and clear search" })); });
    await waitFor(() => expect(client.isFetching()).toBe(0));
    params = new URLSearchParams(view.getByTestId("location").textContent!);
    expect(params.has("ships")).toBe(false);
    expect(params.get("view")).toBe("week");
  } finally { view.unmount(); client.clear(); fetch.mockRestore(); }
});

test("canonical chips use all explicit command IDs, never unit or sender", () => {
  expect(commandKeys([])).toEqual(["unassigned:"]);
  expect(commandKeys(["demo-tern", "demo-halyard", "demo-tern"])).toEqual(["unit:demo-tern", "unit:demo-halyard"]);
  const key = "fictional-only@r1";
  const message = create(MessageRecordSchema, { sourceMessageId: key, sender: "USS Meridian", events: [{ sourceEventId: "point", unit: "demo-meridian" }] });
  const view = renderWithProviders(<DayTimeline
    messages={[message]} commands={roster.commands}
    sourceItems={[{ key: `${key}#point`, messageKey: key, factId: "point", commandIds: [], kind: "point", at: "2026-11-05T08:00:00Z", title: "Fictional check", reviewRequired: true }]}
    from={Date.parse("2026-11-05T00:00:00Z")} to={Date.parse("2026-11-06T00:00:00Z")} interval={60} returnTo="/calendar"
  />);
  expect(view.getByRole("link", { name: "Fictional check, source record" }).textContent).toContain("REVIEW");
  expect(view.queryByText("MERIDIAN")).toBeNull();
  expect(message.events[0].startAt).toBeUndefined(); // presentation must not mutate the cached message
});

test("roster rejects duplicate identities and never substitutes demo data on failure", async () => {
  const fetch = spyOn(globalThis, "fetch").mockImplementation(async () => Response.json({ ...roster, commands: [roster.commands[0], roster.commands[0]] }));
  try { await expect(readCommands()).rejects.toThrow("duplicate"); }
  finally { fetch.mockRestore(); }
});
