import "../route-registry";
import { expect, spyOn, test } from "bun:test";
import { fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderWithProviders, testSession } from "../test-utils/render";
import { AccountProfileProvider } from "./AccountProfileProvider";
import { ResponsibilitySelection } from "./responsibility-selection";
import type { AccountSettings, MessageScope } from "./session";
import Account from "../pages/account";

const catalog = {
  items: [
    {
      id: "communications",
      name: "Communications",
      kind: "department",
      messageTypes: ["OPTASK COMMS"],
    },
    {
      id: "watch",
      name: "Officer of the watch",
      kind: "watch_role",
      messageTypes: ["OPTASK GENERAL"],
    },
    { id: "empty", name: "Unconfigured profile", kind: "department", messageTypes: [] },
  ],
  messageTypes: ["OPTASK COMMS", "OPTASK GENERAL"],
};

test("named department and watch selections preserve command scope and unknown saved profiles until explicitly removed", async () => {
  let settings: AccountSettings = {
    ...testSession.settings,
    messageScope: {
      allCommands: false,
      commandIds: ["COMMAND-A"],
      includeUnassigned: true,
      responsibilityIds: ["retired"],
    },
  };
  const writes: MessageScope[] = [];
  const fetch = spyOn(globalThis, "fetch").mockImplementation(async (path, init) => {
    if (String(path).endsWith("/responsibilities")) return new Response(JSON.stringify(catalog));
    if (String(path).endsWith("/commands"))
      return new Response(JSON.stringify({ commandIds: ["COMMAND-A"], limited: false }));
    if (String(path).endsWith("/settings")) {
      const update = JSON.parse(String(init?.body)) as AccountSettings;
      writes.push(update.messageScope!);
      if (update.messageScope?.responsibilityIds?.includes("retired"))
        return new Response(JSON.stringify({ message: "Saved profile unavailable" }), {
          status: 400,
        });
      settings = update;
      return new Response(JSON.stringify(settings));
    }
    return new Response(JSON.stringify({ ...testSession, settings }));
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = renderWithProviders(
    <QueryClientProvider client={client}>
      <AccountProfileProvider>
        <Account />
      </AccountProfileProvider>
    </QueryClientProvider>
  );
  try {
    await waitFor(() => expect(view.getByLabelText(/Communications/)).toBeTruthy());
    expect(view.getByLabelText(/Saved profile: retired/)).toBeChecked();
    expect(view.getByLabelText(/Communications/)).not.toBeChecked();
    expect(view.getByLabelText(/Officer of the watch/)).not.toBeChecked();
    fireEvent.click(view.getByLabelText(/Communications/));
    fireEvent.click(view.getByRole("button", { name: "Save settings" }));
    await waitFor(() =>
      expect(view.getByRole("alert").textContent).toContain("Saved profile unavailable")
    );
    expect(writes[0]?.responsibilityIds).toEqual(["retired", "communications"]);
    expect(view.getByLabelText(/Saved profile: retired/)).toBeChecked();
    fireEvent.click(view.getByLabelText(/Saved profile: retired/));
    fireEvent.click(view.getByLabelText(/Officer of the watch/));
    fireEvent.click(view.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(view.getByText(/Settings saved/)).toBeTruthy());
    expect(writes[1]).toEqual({
      allCommands: false,
      commandIds: ["COMMAND-A"],
      includeUnassigned: true,
      responsibilityIds: ["communications", "watch"],
    });
  } finally {
    view.unmount();
    client.clear();
    fetch.mockRestore();
  }
});

test("an empty selected profile shows no matching categories rather than all categories", async () => {
  const fetch = spyOn(globalThis, "fetch").mockImplementation(
    async () => new Response(JSON.stringify(catalog))
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = renderWithProviders(
    <QueryClientProvider client={client}>
      <ResponsibilitySelection
        selected={["empty"]}
        onChange={() => {
          throw new Error("Selection must stay unchanged");
        }}
      />
    </QueryClientProvider>
  );
  try {
    await waitFor(() =>
      expect(
        view.getByText("These profiles include no message categories, so no messages will match.")
      ).toBeTruthy()
    );
    expect(view.getByLabelText(/Unconfigured profile/)).toBeChecked();
    expect(
      view.queryByText("No profile selected: all message categories are included.")
    ).toBeNull();
  } finally {
    view.unmount();
    client.clear();
    fetch.mockRestore();
  }
});

test("malformed profile categories show an error and preserve saved choices", async () => {
  const fetch = spyOn(globalThis, "fetch").mockImplementation(
    async () =>
      new Response(
        JSON.stringify({ ...catalog, items: [{ ...catalog.items[0], messageTypes: null }] })
      )
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = renderWithProviders(
    <QueryClientProvider client={client}>
      <ResponsibilitySelection
        selected={["communications"]}
        onChange={() => {
          throw new Error("Selection must stay unchanged");
        }}
      />
    </QueryClientProvider>
  );
  try {
    await waitFor(() =>
      expect(view.getByRole("alert").textContent).toContain("saved selections are unchanged")
    );
    expect(view.getByLabelText(/Saved profile: communications/)).toBeChecked();
    expect(
      view.queryByText("No profile selected: all message categories are included.")
    ).toBeNull();
  } finally {
    view.unmount();
    client.clear();
    fetch.mockRestore();
  }
});
