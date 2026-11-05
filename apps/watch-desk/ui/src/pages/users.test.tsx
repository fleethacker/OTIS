import "../route-registry";
import { expect, spyOn, test } from "bun:test";
import { waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderWithProviders, testSession } from "../test-utils/render";
import { SessionContext, type AccountSession } from "../components/session";
import Users from "./users";

function sessionValue(session: AccountSession) {
  return { session, refresh: async () => {}, saveSettings: async () => {}, logout: async () => {} };
}
test("viewer cannot fetch the administrative directory", () => {
  const fetch = spyOn(globalThis, "fetch");
  const view = renderWithProviders(<Users />);
  try {
    expect(view.getByRole("alert").textContent).toContain("Administrator access is required");
    expect(view.queryByRole("button", { name: "Save station assignment" })).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    view.unmount();
    fetch.mockRestore();
  }
});
test("station administration keeps provider roles read-only and routes account lifecycle to native settings", async () => {
  const admin = {
    ...testSession,
    user: { ...testSession.user!, role: "admin" as const },
    permissions: ["schedule:read", "draft:write", "users:manage"],
  };
  const target = {
    ...testSession.user!,
    id: "target-id",
    username: "Target user",
    displayName: "Target user",
  };
  const fetch = spyOn(globalThis, "fetch").mockImplementation(
    async (path) =>
      new Response(
        JSON.stringify(
          String(path).includes("/briefing/responsibilities")
            ? { items: [], messageTypes: [] }
            : { users: [target] }
        )
      )
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = renderWithProviders(
    <SessionContext.Provider value={sessionValue(admin)}>
      <QueryClientProvider client={client}>
        <Users />
      </QueryClientProvider>
    </SessionContext.Provider>
  );
  try {
    await waitFor(() => expect(view.getByRole("heading", { name: "Target user" })).toBeTruthy());
    expect(view.getByLabelText("Permission level for Target user")).toHaveTextContent("Viewer");
    expect(view.queryByRole("combobox", { name: "Permission level for Target user" })).toBeNull();
    expect(view.queryByLabelText("Account active for Target user")).toBeNull();
    expect(view.getByRole("link", { name: "Settings · Users" })).toHaveAttribute(
      "href",
      "/settings"
    );
  } finally {
    view.unmount();
    client.clear();
    fetch.mockRestore();
  }
});
