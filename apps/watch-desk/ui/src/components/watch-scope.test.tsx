import { expect, spyOn, test } from "bun:test";
import { waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRouterTransport } from "@connectrpc/connect";
import { TransportProvider } from "@connectrpc/connect-query";
import { AppService } from "../gen/app/v1/app_pb";
import { renderWithProviders, testSession } from "../test-utils/render";
import { SessionContext, type AccountSession } from "./session";
import { useCommands } from "./command-roster";
import { useChanges } from "./watch-changes";
import { useWatchContext } from "./watch-context";
import { useNotifications } from "./notification-data";

function WatchData() {
  const roster = useCommands();
  const changes = useChanges(
    { since: "2026-11-05T00:00:00Z", until: "2026-11-05T12:00:00Z", filters: {} },
    true
  );
  const context = useWatchContext(true);
  const notifications = useNotifications("watch");
  return (
    <>
      <output aria-label="Roster">
        {roster.data?.commands.map((command) => command.name).join(", ")}
      </output>
      <output aria-label="Turnover">
        {changes.data?.pages
          .flatMap((page) => page.items)
          .map((item) => item.title)
          .join(", ")}
      </output>
      <output aria-label="Context">{context.data?.context.operationName}</output>
      <output aria-label="Notifications">
        {notifications.data?.pages
          .flatMap((page) => page.items)
          .map((item) => item.context)
          .join(", ")}
      </output>
    </>
  );
}

test("watch roster, turnover, suggestions and notifications discard cached data when relevance narrows", async () => {
  let name = "Previous command";
  const fetch = spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const path = String(input);
    if (path.endsWith("/commands/list"))
      return new Response(
        JSON.stringify({
          commands: [
            { id: "unit", name, shortLabel: name, group: "Group", colorIndex: 0, isOwnShip: false },
          ],
          source: "test",
          version: "1",
          provenance: "fictional",
          assignmentEnabled: false,
        })
      );
    if (path.endsWith("/changes/list"))
      return new Response(
        JSON.stringify({
          items: [{ id: "event", title: name, issuedAt: "2026-11-05T10:00:00Z" }],
          unknownTime: [],
          unknownHiddenCount: 0,
          unknownLimited: false,
          returnedNewCount: 1,
          hiddenCount: 0,
          hiddenShipIds: [],
          nextBefore: null,
          watermark: 1,
          availability: {},
        })
      );
    if (path.endsWith("/watch-context/get"))
      return new Response(
        JSON.stringify({
          context: {
            ownShipId: "",
            shipName: "",
            operationName: name,
            groupCommand: "",
            defaultShips: [],
            turnoverUtc: [],
          },
          confirmations: {},
          canEdit: false,
          suggestions: [],
        })
      );
    return new Response(
      JSON.stringify({
        items: [{ id: 1, version: 1, context: name }],
        unread: 0,
        watermark: 1,
        nextBefore: null,
        catchingUp: false,
      })
    );
  });
  const transport = createRouterTransport((router) =>
    router.service(AppService, { getIdentity: () => ({ username: "test-user", role: "viewer" }) })
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const content = (session: AccountSession) => (
    <SessionContext.Provider
      value={{
        session,
        refresh: async () => {},
        saveSettings: async () => {},
        logout: async () => {},
      }}
    >
      <TransportProvider transport={transport}>
        <QueryClientProvider client={client}>
          <WatchData />
        </QueryClientProvider>
      </TransportProvider>
    </SessionContext.Provider>
  );
  const view = renderWithProviders(content(testSession));
  const labels = ["Roster", "Turnover", "Context", "Notifications"];
  try {
    await waitFor(() => {
      for (const label of labels) expect(view.getByLabelText(label).textContent).toBe(name);
    });
    name = "Assigned command";
    view.rerender(
      content({
        ...testSession,
        settings: {
          ...testSession.settings,
          messageScope: { allCommands: false, commandIds: ["ASSIGNED"], includeUnassigned: false },
        },
      })
    );
    for (const label of labels)
      expect(view.getByLabelText(label).textContent).not.toContain("Previous command");
    await waitFor(() => {
      for (const label of labels) expect(view.getByLabelText(label).textContent).toBe(name);
    });
  } finally {
    view.unmount();
    client.clear();
    fetch.mockRestore();
  }
});
