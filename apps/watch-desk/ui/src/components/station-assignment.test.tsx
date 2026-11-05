import "../route-registry";
import { expect, spyOn, test } from "bun:test";
import { fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderWithProviders, testSession } from "../test-utils/render";
import { SessionContext, type AccountUser } from "./session";
import Users from "../pages/users";
import Account from "../pages/account";

const assignment = {
  shipName: "USS America",
  commandIds: ["CMD-AMERICA"],
  department: "Engineering",
  watchStation: "Engineering watch",
  responsibilityIds: ["engineer"],
  includeUnassigned: false,
  revision: 1,
  source: "admin" as const,
};
const catalog = {
  items: [
    {
      id: "engineer",
      name: "Engineering duties",
      kind: "department",
      messageTypes: ["OPTASK ENGINEERING"],
    },
  ],
  messageTypes: ["OPTASK ENGINEERING"],
};
test("administrator assigns and clears a station without changing application permission", async () => {
  const admin = {
    ...testSession,
    permissions: ["schedule:read", "users:manage"],
    user: { ...testSession.user!, role: "admin" as const },
  };
  let target: AccountUser = {
    ...testSession.user!,
    id: "target",
    displayName: "Sailor",
    role: "viewer",
  };
  const writes: Record<string, unknown>[] = [];
  let fail = true;
  const fetch = spyOn(globalThis, "fetch").mockImplementation(async (path, init) => {
    if (String(path).endsWith("/responsibilities")) {
      return new Response(JSON.stringify(catalog));
    }
    if (init?.method === "PATCH") {
      if (fail) {
        return new Response(JSON.stringify({ message: "Assignment temporarily unavailable" }), {
          status: 503,
        });
      }
      const update = JSON.parse(String(init.body));
      writes.push(update);
      target = {
        ...target,
        ...update,
        stationAssignment:
          update.stationAssignment === null
            ? null
            : { ...update.stationAssignment, revision: 1, source: "admin" },
      };
      return new Response(JSON.stringify({ user: target }));
    }
    return new Response(JSON.stringify({ users: [target] }));
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = renderWithProviders(
    <SessionContext.Provider
      value={{
        session: admin,
        refresh: async () => {},
        saveSettings: async () => {},
        logout: async () => {},
      }}
    >
      <QueryClientProvider client={client}>
        <Users />
      </QueryClientProvider>
    </SessionContext.Provider>
  );
  try {
    await waitFor(() => expect(view.getByLabelText("Assign a station for Sailor")).toBeTruthy());
    fireEvent.click(view.getByLabelText("Assign a station for Sailor"));
    fireEvent.change(view.getByLabelText("Ship / command name"), {
      target: { value: assignment.shipName },
    });
    fireEvent.change(view.getByLabelText("Department", { selector: "input" }), {
      target: { value: assignment.department },
    });
    fireEvent.change(view.getByLabelText("Watch station"), {
      target: { value: assignment.watchStation },
    });
    fireEvent.change(view.getByLabelText("Exact command IDs, one per line"), {
      target: { value: "CMD-AMERICA\nCMD-AMERICA\n" },
    });
    await waitFor(() =>
      expect(view.getByRole("checkbox", { name: /Engineering duties/ })).toBeTruthy()
    );
    fireEvent.click(view.getByRole("checkbox", { name: /Engineering duties/ }));
    fireEvent.click(view.getByRole("button", { name: "Save station assignment" }));
    await waitFor(() =>
      expect(view.getByRole("alert").textContent).toContain("temporarily unavailable")
    );
    expect(view.getByLabelText("Watch station")).toHaveValue("Engineering watch");
    fail = false;
    fireEvent.click(view.getByRole("button", { name: "Save station assignment" }));
    await waitFor(() =>
      expect(view.getByRole("button", { name: "Save station assignment" })).toBeDisabled()
    );
    const { revision: _revision, source: _source, ...editable } = assignment;
    expect(writes).toEqual([{ stationAssignment: editable }]);
    expect(view.getByLabelText("Permission level for Sailor")).toHaveTextContent("Viewer");
    fireEvent.click(view.getByLabelText("Assign a station for Sailor"));
    fireEvent.click(view.getByRole("button", { name: "Save station assignment" }));
    await waitFor(() => expect(writes).toHaveLength(2));
    expect(writes[1]).toEqual({ stationAssignment: null });
  } finally {
    view.unmount();
    client.clear();
    fetch.mockRestore();
  }
}, 15000);
test("account station labels are read-only and missing required assignments ask an administrator", async () => {
  const fetch = spyOn(globalThis, "fetch").mockImplementation(
    async (path) =>
      new Response(
        JSON.stringify(
          String(path).endsWith("/commands") ? { commandIds: [], limited: false } : catalog
        )
      )
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const state = (station: typeof assignment | null) => ({
    session: {
      ...testSession,
      stationAssignmentRequired: true,
      user: { ...testSession.user!, role: "viewer" as const, stationAssignment: station },
    },
    refresh: async () => {},
    saveSettings: async () => {},
    logout: async () => {},
  });
  const view = renderWithProviders(
    <SessionContext.Provider value={state(assignment)}>
      <QueryClientProvider client={client}>
        <Account />
      </QueryClientProvider>
    </SessionContext.Provider>
  );
  try {
    expect(view.getByText("USS America")).toBeTruthy();
    expect(view.getByText("Engineering watch")).toBeTruthy();
    expect(view.getByText("Viewer", { selector: "dd" })).toBeTruthy();
    expect(view.queryByRole("textbox", { name: "Watch station" })).toBeNull();
    view.rerender(
      <SessionContext.Provider value={state(null)}>
        <QueryClientProvider client={client}>
          <Account />
        </QueryClientProvider>
      </SessionContext.Provider>
    );
    expect(view.getByRole("alert").textContent).toContain("administrator must assign");
    expect(view.queryByText("USS America")).toBeNull();
  } finally {
    view.unmount();
    client.clear();
    fetch.mockRestore();
  }
});
