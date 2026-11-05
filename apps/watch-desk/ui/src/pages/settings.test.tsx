import { test, expect, spyOn } from "bun:test";
import { fireEvent, waitFor } from "@testing-library/react";
import { createRouterTransport } from "@connectrpc/connect";
import { TransportProvider } from "@connectrpc/connect-query";
import { AppService } from "../gen/app/v1/app_pb";
import { renderWithProviders } from "../test-utils/render";
import { SettingsContext, type SettingsReply } from "../components/settings-data";
import Settings from "./settings";
const shared: SettingsReply = {
  revision: "1:1",
  settings: {
    version: 1,
    shipName: "EXAMPLE SHIP",
    unitName: "",
    commandIds: [],
    outgoingCommand: "EXAMPLE",
    actionAuthority: "OPS",
    defaultTimezone: "UTC",
    ai: null,
  },
};
function mount(role: string) {
  const transport = createRouterTransport((router) =>
    router.service(AppService, { getIdentity: () => ({ username: "watch", role }) })
  );
  return renderWithProviders(
    <TransportProvider transport={transport}>
      <SettingsContext.Provider value={{ shared, timezone: "UTC" }}>
        <Settings />
      </SettingsContext.Provider>
    </TransportProvider>
  );
}
test("Viewer can save timezone and sees no administration controls", async () => {
  const writes: unknown[] = [];
  const fetch = spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
    writes.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ timezone: "America/Chicago" }));
  });
  const view = mount("viewer");
  try {
    fireEvent.change(view.getByLabelText("Timezone"), { target: { value: "America/Chicago" } });
    fireEvent.click(view.getByRole("button", { name: "Save", exact: true }));
    await waitFor(() => expect(view.getByRole("status").textContent).toBe("Saved"));
    expect(writes).toEqual([{ timezone: "America/Chicago" }]);
    expect(view.queryByRole("button", { name: "Users", exact: true })).toBeNull();
    expect(view.queryByRole("button", { name: "AI", exact: true })).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "Command", exact: true }));
    expect(view.getByLabelText("Ship").closest("fieldset")?.disabled).toBe(true);
  } finally {
    view.unmount();
    fetch.mockRestore();
  }
});
test("Admin settings save uses revision and a conflict keeps edits unsaved", async () => {
  let saved: Record<string, unknown> = {};
  const fetch = spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    if (String(input).endsWith("options"))
      return new Response(
        JSON.stringify({ commands: ["EXAMPLE"], aiEndpoints: [], secretRefs: [] })
      );
    saved = JSON.parse(String(init?.body));
    return new Response(
      JSON.stringify({ code: "aborted", message: "Settings changed; reload before saving" }),
      { status: 409 }
    );
  });
  const view = mount("admin");
  try {
    await waitFor(() =>
      expect(view.getByRole("button", { name: "Users", exact: true })).toBeTruthy()
    );
    fireEvent.click(view.getByRole("button", { name: "Command", exact: true }));
    fireEvent.change(view.getByLabelText("Ship"), { target: { value: "CHANGED SHIP" } });
    fireEvent.click(view.getByRole("button", { name: "Save", exact: true }));
    await waitFor(() => expect(view.getByRole("alert").textContent).toContain("reload"));
    expect(saved.revision).toBe("1:1");
    expect(view.getByText("Unsaved")).toBeTruthy();
    expect((view.getByLabelText("Ship") as HTMLInputElement).value).toBe("CHANGED SHIP");
  } finally {
    view.unmount();
    fetch.mockRestore();
  }
});
