import { expect, spyOn, test } from "bun:test";
import { fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderWithProviders, testSession } from "../test-utils/render";
import { SessionContext, type AccountSession } from "./session";
import { ResponsibilitiesAdmin } from "./responsibilities-admin";
import type { ResponsibilityProfile } from "./responsibility-data";
const admin: AccountSession = {
  ...testSession,
  user: { ...testSession.user!, role: "admin" },
  permissions: ["schedule:read", "users:manage"],
};
function mount(session = admin) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
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
        <ResponsibilitiesAdmin />
      </QueryClientProvider>
    </SessionContext.Provider>
  );
  return {
    view,
    cleanup: () => {
      view.unmount();
      client.clear();
    },
  };
}
test("non-administrators cannot load or edit responsibility definitions", () => {
  const fetch = spyOn(globalThis, "fetch");
  const { view, cleanup } = mount(testSession);
  try {
    expect(view.queryByRole("form")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    cleanup();
    fetch.mockRestore();
  }
});
test("administrator creates and edits category mappings, retaining failed edits for retry", async () => {
  let items: ResponsibilityProfile[] = [];
  let fail = false;
  const writes: { method: string; body: unknown }[] = [];
  const fetch = spyOn(globalThis, "fetch").mockImplementation(async (_path, init) => {
    if (init?.method === "POST" || init?.method === "PATCH") {
      if (fail)
        return new Response(JSON.stringify({ message: "Save is temporarily unavailable" }), {
          status: 503,
        });
      const body = JSON.parse(String(init.body));
      writes.push({ method: init.method, body });
      const item = { id: "communications", ...body };
      items = [item];
      return new Response(JSON.stringify({ item }));
    }
    return new Response(JSON.stringify({ items, messageTypes: ["OPTASK COMMS", "OPTASK ASW"] }));
  });
  const { view, cleanup } = mount();
  try {
    await waitFor(() => expect(view.getByLabelText("OPTASK COMMS")).toBeEnabled());
    fireEvent.change(view.getByLabelText("Responsibility name"), {
      target: { value: "Communications" },
    });
    fireEvent.click(view.getByLabelText("OPTASK COMMS"));
    fireEvent.click(view.getByRole("button", { name: "Save responsibility" }));
    await waitFor(() => expect(view.getByRole("heading", { name: "Communications" })).toBeTruthy());
    expect(view.getByText(/Responsibility saved/)).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Edit Communications" }));
    fireEvent.change(view.getByLabelText("Responsibility kind"), {
      target: { value: "watch_role" },
    });
    fireEvent.click(view.getByLabelText("OPTASK COMMS"));
    fail = true;
    fireEvent.click(view.getByRole("button", { name: "Save responsibility" }));
    await waitFor(() =>
      expect(view.getByRole("alert").textContent).toContain("Save is temporarily unavailable")
    );
    expect(view.getByLabelText("Responsibility name")).toHaveValue("Communications");
    expect(view.getByLabelText("Responsibility kind")).toHaveValue("watch_role");
    expect(view.getByLabelText("OPTASK COMMS")).not.toBeChecked();
    fail = false;
    fireEvent.click(view.getByRole("button", { name: "Save responsibility" }));
    await waitFor(() => expect(view.getByText(/No message categories selected/)).toBeTruthy());
    expect(writes).toEqual([
      {
        method: "POST",
        body: { name: "Communications", kind: "department", messageTypes: ["OPTASK COMMS"] },
      },
      { method: "PATCH", body: { name: "Communications", kind: "watch_role", messageTypes: [] } },
    ]);
    expect(view.getByText("Watch role", { selector: "p" })).toBeTruthy();
  } finally {
    cleanup();
    fetch.mockRestore();
  }
});
