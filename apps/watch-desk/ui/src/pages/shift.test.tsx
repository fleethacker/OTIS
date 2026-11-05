import "../route-registry";
import { expect, spyOn, test } from "bun:test";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRouterTransport } from "@connectrpc/connect";
import { TransportProvider } from "@connectrpc/connect-query";
import { AppService } from "../gen/app/v1/app_pb";
import { DraftService } from "../gen/app/v1/drafts_pb";
import { renderWithProviders, testSession } from "../test-utils/render";
import { SessionContext, defaultMessageScope, type AccountSession } from "../components/session";
import { shiftReturn, type BriefingItem, type BriefingPage } from "../components/briefing-data";
import Shift from "./shift";

const item = (n: number): BriefingItem => ({
  messageKey: `message-${n}@r1`,
  subject: `Watch message ${n}`,
  type: "OPTASK COMMS",
  originator: "EXERCISE COMMAND",
  issuedAt: "2008-11-03T08:00:00Z",
  availableAt: "2026-11-05T09:30:00Z",
  commandIds: [],
});
const page = (items: BriefingItem[], overrides: Partial<BriefingPage> = {}): BriefingPage => ({
  items,
  since: "2026-11-04T10:00:00Z",
  through: "2026-11-05T10:00:00Z",
  firstLogin: false,
  totalRecords: items.length,
  nextPageToken: null,
  previousPageToken: null,
  page: 1,
  pageSize: 20,
  messageScope: defaultMessageScope,
  ...overrides,
});
function mount(
  session: AccountSession = testSession,
  route = "/shift?returnTo=%2Fcalendar%3Fview%3Dweek"
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const transport = createRouterTransport((router) => {
    router.service(AppService, { getIdentity: () => ({ username: "test-user" }) });
    router.service(DraftService, {
      readDraft: () => ({}),
      readPreparation: () => ({ fieldsJson: "{}", historyJson: "[]" }),
    });
  });
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
        <TransportProvider transport={transport}>
          <Shift />
        </TransportProvider>
      </QueryClientProvider>
    </SessionContext.Provider>,
    { route }
  );
  return { ...view, client };
}
test("shift briefing pages all messages, shows availability separately from old issue dates and opens the exact record", async () => {
  const requests: Record<string, unknown>[] = [];
  const fetch = spyOn(globalThis, "fetch").mockImplementation(async (path, init) => {
    const body = JSON.parse(String(init?.body));
    if (String(path).endsWith("/detail")) {
      expect(body.key).toBe("message-21@r1");
      return new Response(
        JSON.stringify({
          messages: [
            {
              sourceMessageId: body.key,
              subject: "Selected watch message",
              rawText: "EXERCISE RAW MESSAGE",
            },
          ],
          meta: {},
        })
      );
    }
    requests.push(body);
    return new Response(
      JSON.stringify(
        body.pageToken === "next-page"
          ? page([item(21)], { totalRecords: 21, page: 2, previousPageToken: "first-page" })
          : page(
              Array.from({ length: 20 }, (_, index) => item(index + 1)),
              { totalRecords: 21, nextPageToken: "next-page" }
            )
      )
    );
  });
  const view = mount({
    ...testSession,
    user: { ...testSession.user!, previousLoginAt: "2026-11-05T09:59:00Z" },
  });
  try {
    await waitFor(() => expect(view.getByText("21 records")).toBeTruthy());
    expect(
      within(view.getByRole("region", { name: "Shift message list" })).getAllByRole("button")
    ).toHaveLength(20);
    expect(view.getByText(/sign-in at 2026-11-04 10:00:00 UTC/)).toBeTruthy();
    expect(view.getAllByText("03 NOV 2008 080000Z")).toHaveLength(20);
    expect(view.getAllByText("2026-11-05 09:30:00 UTC")).toHaveLength(20);
    expect(view.getByText(/Unassigned traffic included/)).toBeTruthy();
    expect(view.getByRole("link", { name: "Continue to Calendar" })).toHaveAttribute(
      "href",
      "/calendar?view=week"
    );
    fireEvent.click(view.getByRole("button", { name: "Next results page" }));
    await waitFor(() => expect(view.getByText("Watch message 21")).toBeTruthy());
    expect(view.queryByText("Watch message 1")).toBeNull();
    expect(view.getByRole("button", { name: "Next results page" })).toBeDisabled();
    fireEvent.click(view.getByRole("button", { name: /Watch message 21/ }));
    await waitFor(() =>
      expect(view.getByRole("article", { name: "Selected message" })).toBeTruthy()
    );
    fireEvent.click(view.getByRole("tab", { name: "Raw message" }));
    expect(view.getByText("EXERCISE RAW MESSAGE")).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Close message" }));
    expect(view.queryByRole("article", { name: "Selected message" })).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "Previous results page" }));
    await waitFor(() => expect(view.getByText("Watch message 1")).toBeTruthy());
    expect(requests).toEqual([{}, { pageToken: "next-page" }, { pageToken: "first-page" }]);
  } finally {
    view.unmount();
    view.client.clear();
    fetch.mockRestore();
  }
});

test("first briefing describes all retained traffic and empty scope remains explicit", async () => {
  const scope = { allCommands: false, commandIds: [], includeUnassigned: false };
  const fetch = spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify(page([], { since: null, firstLogin: true, messageScope: scope })))
  );
  const view = mount({
    ...testSession,
    settings: { ...testSession.settings, messageScope: scope },
  });
  try {
    await waitFor(() => expect(view.getByRole("heading", { name: "First briefing" })).toBeTruthy());
    expect(view.getByText("All retained messages available at sign-in.")).toBeTruthy();
    expect(view.getByText(/current relevance settings select no messages/)).toBeTruthy();
    expect(view.queryByText(/Since your previous/)).toBeNull();
    expect(view.getByText("0 records")).toBeTruthy();
  } finally {
    view.unmount();
    view.client.clear();
    fetch.mockRestore();
  }
});

test("source failure is not reported as zero traffic, and retry can load an empty briefing", async () => {
  let failed = true;
  const fetch = spyOn(globalThis, "fetch").mockImplementation(
    async () =>
      new Response(JSON.stringify(failed ? { message: "Message source unavailable" } : page([])), {
        status: failed ? 503 : 200,
      })
  );
  const view = mount();
  try {
    await waitFor(() =>
      expect(view.getByRole("alert").textContent).toContain("Message source unavailable")
    );
    expect(view.queryByText("0 records")).toBeNull();
    expect(view.queryByText("No new messages match your scope")).toBeNull();
    failed = false;
    fireEvent.click(view.getByRole("button", { name: "Retry briefing" }));
    await waitFor(() => expect(view.getByText("No new messages match your scope")).toBeTruthy());
    expect(view.getByText("0 records")).toBeTruthy();
  } finally {
    view.unmount();
    view.client.clear();
    fetch.mockRestore();
  }
});

test("older and unavailable login windows request fresh sign-in without claiming empty traffic", () => {
  const fetch = spyOn(globalThis, "fetch");
  try {
    for (const login of [
      null,
      { startedAt: "2026-11-05T10:00:00Z", previousLoginAt: null, briefingAvailable: false },
    ]) {
      const view = mount(
        { ...testSession, login },
        "/shift?returnTo=https%3A%2F%2Foutside.invalid"
      );
      expect(view.getByRole("heading", { name: "Start a fresh shift briefing" })).toBeTruthy();
      expect(view.getByRole("link", { name: "Sign in again" })).toHaveAttribute(
        "href",
        "/auth/login?return=%2Fcalendar"
      );
      expect(view.getByRole("link", { name: "Continue to Calendar" })).toHaveAttribute(
        "href",
        "/calendar"
      );
      expect(view.queryByText("0 records")).toBeNull();
      view.unmount();
      view.client.clear();
    }
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    fetch.mockRestore();
  }
});

test("briefing continuation accepts workspace links and rejects external or action destinations", () => {
  expect(shiftReturn("/messages?record=one%40r1")).toBe("/messages?record=one%40r1");
  expect(shiftReturn("/settings")).toBe("/settings");
  expect(shiftReturn("/watch-settings?returnTo=%2Fcalendar")).toBe(
    "/watch-settings?returnTo=%2Fcalendar"
  );
  for (const target of [
    null,
    "https://outside.invalid",
    "//outside.invalid",
    "/\\outside.invalid",
    "/api/v1/auth/logout",
    "/shift",
    "javascript:alert(1)",
  ]) {
    expect(shiftReturn(target)).toBe("/calendar");
  }
});

test("malformed briefing items, paging and timestamps fail visibly instead of rendering empty traffic", async () => {
  let payload: unknown;
  const fetch = spyOn(globalThis, "fetch").mockImplementation(
    async () => new Response(JSON.stringify(payload))
  );
  try {
    for (const invalid of [
      { ...page([item(1)]), items: [null] },
      { ...page([item(1)]), items: [{ ...item(1), commandIds: null }] },
      { ...page([item(1)]), items: [{ ...item(1), availableAt: "not a date" }] },
      { ...page([item(1)]), pageSize: 0 },
      { ...page([item(1)]), nextPageToken: {} },
      { ...page([item(1)]), totalRecords: -1 },
    ]) {
      payload = invalid;
      const view = mount();
      await waitFor(() =>
        expect(view.getByRole("alert").textContent).toContain("could not be verified")
      );
      expect(view.queryByText("0 records")).toBeNull();
      expect(view.queryByText("Watch message 1")).toBeNull();
      view.unmount();
      view.client.clear();
    }
  } finally {
    fetch.mockRestore();
  }
});
