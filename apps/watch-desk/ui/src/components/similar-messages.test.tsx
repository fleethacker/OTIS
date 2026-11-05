import "../route-registry";
import { expect, spyOn, test } from "bun:test";
import { act, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { create } from "@bufbuild/protobuf";
import { renderWithProviders, testSession } from "../test-utils/render";
import { SessionContext, type StationAssignment } from "./session";
import { MessageRecordSchema } from "../gen/app/v1/models_pb";
import { MessageReader } from "./message-reader";
import Messages from "../pages/messages";

const station: StationAssignment = {
  shipName: "USS America",
  commandIds: ["CMD-AMERICA"],
  department: "Engineering",
  watchStation: "Engineering watch",
  responsibilityIds: ["engineering"],
  includeUnassigned: false,
  revision: 1,
  source: "admin",
};
const key = "sha256:anchor@r1";
const match = "sha256:match@r2";
const scope = {
  allCommands: false,
  commandIds: ["CMD-AMERICA"],
  includeUnassigned: false,
  messageTypes: ["OPTASK ENGINEERING"],
  matchNone: false,
};
function payload(messages: unknown[] = [{ sourceMessageId: match, subject: "Pump maintenance" }]) {
  return {
    messages,
    meta: {
      similarTo: { messageKey: key, subject: "Engineering tasking" },
      effectiveScope: scope,
      stationContext: { stationAssignment: station, effectiveScope: scope },
      executedMode: "hybrid",
      windowLimited: true,
      matchedExcerpts: {
        [match]: [
          { passageId: "passage-1", text: '<img src=x onerror="alert(1)"> Inspect cooling pump.' },
        ],
      },
    },
  };
}
function mount(route = `/messages?${new URLSearchParams({ similarTo: key })}`) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const session = { ...testSession, user: { ...testSession.user!, stationAssignment: station } };
  const view = renderWithProviders(
    <SessionContext.Provider
      value={{
        session,
        refresh: async () => {},
        saveSettings: async () => {},
        logout: async () => {},
      }}
    >
      <QueryClientProvider client={client}>
        <Messages />
      </QueryClientProvider>
    </SessionContext.Provider>,
    { route }
  );
  return {
    view,
    cleanup: () => {
      view.unmount();
      client.clear();
    },
  };
}
test("similar messages retain server station scope, escape excerpts, and request exact source evidence", async () => {
  const requests: { path: string; body: unknown }[] = [];
  const fetch = spyOn(globalThis, "fetch").mockImplementation(async (path, init) => {
    requests.push({ path: String(path), body: JSON.parse(String(init?.body ?? "{}")) });
    return new Response(
      JSON.stringify(
        String(path).endsWith("/evidence")
          ? { records: [{ line: 12, source: "Original message" }] }
          : payload()
      )
    );
  });
  const { view, cleanup } = mount();
  try {
    await waitFor(() =>
      expect(view.getByRole("button", { name: /Pump maintenance/ })).toBeTruthy()
    );
    expect(view.getByText("USS America")).toBeTruthy();
    expect(view.getByText("Engineering watch")).toBeTruthy();
    expect(view.getByText("Message categories: OPTASK ENGINEERING")).toBeTruthy();
    expect(view.container.querySelector("img, script")).toBeNull();
    expect(view.getByText(/Inspect cooling pump/)).toBeTruthy();
    expect(view.getByRole("status").textContent).toContain("more matches may exist");
    expect(requests[0]).toEqual({
      path: "/api/v1/messages/similar",
      body: { key, mode: "hybrid" },
    });
    const details = view.getByText("View excerpt evidence").closest("details")!;
    await act(async () => {
      details.open = true;
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    await waitFor(() => expect(view.getByText(/Original message/)).toBeTruthy());
    expect(requests.find((request) => request.path.endsWith("/evidence"))?.body).toEqual({
      key: match,
      passageId: "passage-1",
    });
  } finally {
    cleanup();
    fetch.mockRestore();
  }
});
test("offline hybrid requires an explicit keyword retry and reports an empty bounded result", async () => {
  const requests: { key: string; mode: string }[] = [];
  const fetch = spyOn(globalThis, "fetch").mockImplementation(async (_path, init) => {
    const request = JSON.parse(String(init?.body));
    requests.push(request);
    return request.mode === "hybrid"
      ? new Response(JSON.stringify({ code: "unavailable", message: "Local model unavailable" }), {
          status: 503,
        })
      : new Response(
          JSON.stringify({ ...payload([]), meta: { ...payload([]).meta, executedMode: "keyword" } })
        );
  });
  const { view, cleanup } = mount();
  try {
    await waitFor(() =>
      expect(view.getByRole("button", { name: "Try keyword search" })).toBeTruthy()
    );
    expect(requests).toEqual([{ key, mode: "hybrid" }]);
    fireEvent.click(view.getByRole("button", { name: "Try keyword search" }));
    await waitFor(() =>
      expect(view.getByRole("heading", { name: "No similar messages found" })).toBeTruthy()
    );
    expect(requests).toEqual([
      { key, mode: "hybrid" },
      { key, mode: "keyword" },
    ]);
    expect(view.getByRole("status").textContent).toContain("Keyword search");
  } finally {
    cleanup();
    fetch.mockRestore();
  }
});
test("legacy references and malformed similar results never become an unrestricted list", async () => {
  const fetch = spyOn(globalThis, "fetch").mockImplementation(
    async () => new Response(JSON.stringify({ messages: [], meta: { similarTo: null } }))
  );
  const legacy = mount("/messages?similarTo=legacy%3Aold");
  try {
    expect(legacy.view.getByRole("alert").textContent).toContain("Legacy or missing");
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    legacy.cleanup();
  }
  const current = mount();
  try {
    await waitFor(() =>
      expect(current.view.getByRole("alert").textContent).toContain("could not be verified")
    );
    expect(current.view.queryByRole("button", { name: "Try keyword search" })).toBeNull();
    expect(current.view.queryByRole("heading", { name: "No similar messages found" })).toBeNull();
  } finally {
    current.cleanup();
    fetch.mockRestore();
  }
});
test("reader exposes an encoded similar link for a current source only", () => {
  const view = renderWithProviders(
    <MessageReader message={create(MessageRecordSchema, { sourceMessageId: "sha256:x/y?z" })} />
  );
  const action = view.getByRole("link", { name: "Find similar messages" });
  expect(action.getAttribute("href")).toBe(
    "/messages?similarTo=sha256%3Ax%2Fy%3Fz"
  );
  expect(action.classList.contains("btn-outline")).toBe(true);
  expect(action.querySelector("svg[aria-hidden='true']")).toBeTruthy();
  view.unmount();
  const withReturn = renderWithProviders(
    <MessageReader message={create(MessageRecordSchema, { sourceMessageId: "sha256:x/y?z" })} />,
    { route: "/messages?returnTo=%2Fcalendar%3Fview%3Dweek" }
  );
  expect(withReturn.getByRole("link", { name: "Find similar messages" }).getAttribute("href")).toBe(
    "/messages?similarTo=sha256%3Ax%2Fy%3Fz&returnTo=%2Fcalendar%3Fview%3Dweek"
  );
  withReturn.unmount();
  const legacy = renderWithProviders(
    <MessageReader message={create(MessageRecordSchema, { sourceMessageId: "legacy:42" })} />
  );
  expect(legacy.queryByRole("link", { name: "Find similar messages" })).toBeNull();
  legacy.unmount();
});
