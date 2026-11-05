import { test, expect, spyOn } from "bun:test";
import { act, fireEvent, waitFor, within } from "@testing-library/react";
import { createRouterTransport } from "@connectrpc/connect";
import { TransportProvider } from "@connectrpc/connect-query";
import { AppService } from "../gen/app/v1/app_pb";
import { renderWithProviders } from "../test-utils/render";
import { SettingsContext, type SettingsReply } from "./settings-data";
import { SettingsButton } from "./settings-button";
import { UserMenu } from "./UserMenu";

const shared: SettingsReply = {
  revision: "1:1",
  settings: {
    version: 2,
    shipName: "EXAMPLE SHIP",
    unitName: "",
    commandIds: [],
    outgoingCommand: "EXAMPLE",
    actionAuthority: "OPS",
    defaultTimezone: "UTC",
    ai: null,
    turnoverUtc: ["0000Z"],
    defaultShips: [],
    operationName: "",
    groupCommand: "",
  },
};
function mount(role: string) {
  const transport = createRouterTransport((router) =>
    router.service(AppService, { getIdentity: () => ({ username: "watch", role }) })
  );
  return renderWithProviders(
    <TransportProvider transport={transport}>
      <SettingsContext.Provider value={{ shared, timezone: "UTC" }}>
        <UserMenu />
        <SettingsButton />
      </SettingsContext.Provider>
    </TransportProvider>
  );
}

test("Admin gear opens settings without navigation and preserves edits across close and Escape", async () => {
  const fetch = spyOn(globalThis, "fetch").mockImplementation(
    async () =>
      new Response(JSON.stringify({ commands: ["EXAMPLE"], aiEndpoints: [], secretRefs: [] }))
  );
  const view = mount("admin");
  try {
    const gear = await view.findByRole("button", { name: "Settings", exact: true });
    expect(view.queryByRole("dialog")).toBeNull();
    gear.focus();
    await act(async () => fireEvent.click(gear));
    const modal = within(view.getByRole("dialog", { name: "Settings" }));
    fireEvent.click(modal.getByRole("button", { name: "Command", exact: true }));
    fireEvent.change(modal.getByLabelText("Ship display name"), { target: { value: "CHANGED SHIP" } });
    await act(async () => fireEvent.click(modal.getByRole("button", { name: "Close settings" })));
    expect(view.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(gear);
    await act(async () => fireEvent.click(gear));
    expect((modal.getByLabelText("Ship display name") as HTMLInputElement).value).toBe("CHANGED SHIP");
    expect(modal.getByText("Unsaved")).toBeTruthy();
    await act(async () => {
      fireEvent(
        view.getByRole("dialog"),
        new Event("cancel", { bubbles: false, cancelable: true })
      );
    });
    expect(view.queryByRole("dialog")).toBeNull();
    expect(gear.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(gear);
  } finally {
    view.unmount();
    fetch.mockRestore();
  }
});

test("Viewer has no settings gear and retains personal preferences in the account menu", async () => {
  const view = mount("viewer");
  try {
    await waitFor(() => expect(view.getByRole("button", { name: "Account menu" })).toBeTruthy());
    expect(view.queryByRole("button", { name: "Settings", exact: true })).toBeNull();
    expect(view.queryByRole("dialog")).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "Account menu" }));
    expect(view.getByRole("menuitem", { name: "Preferences" }).getAttribute("href")).toBe(
      "/settings"
    );
  } finally {
    view.unmount();
  }
});
