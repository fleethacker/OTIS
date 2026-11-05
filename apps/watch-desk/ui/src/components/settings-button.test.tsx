import { test, expect } from "bun:test";
import { fireEvent } from "@testing-library/react";
import { createRouterTransport } from "@connectrpc/connect";
import { TransportProvider } from "@connectrpc/connect-query";
import { useLocation } from "react-router-dom";
import { AppService } from "../gen/app/v1/app_pb";
import { renderWithProviders } from "../test-utils/render";
import { SettingsButton } from "./settings-button";
import { UserMenu } from "./UserMenu";

function CurrentRoute() {
  return <output aria-label="Current route">{useLocation().pathname}</output>;
}

function mount(role: string) {
  const transport = createRouterTransport((router) =>
    router.service(AppService, { getIdentity: () => ({ username: "watch", role }) })
  );
  return renderWithProviders(
    <TransportProvider transport={transport}>
      <UserMenu />
      <SettingsButton />
      <CurrentRoute />
    </TransportProvider>
  );
}

for (const role of ["viewer", "admin"]) {
  test(`${role} gear opens Account & settings as a page without a modal`, async () => {
    const view = mount(role);
    try {
      const gear = await view.findByRole("link", { name: "Account & settings" });
      expect(gear.getAttribute("href")).toBe("/account");
      fireEvent.click(gear);
      expect(view.getByLabelText("Current route").textContent).toBe("/account");
      expect(view.queryByRole("dialog")).toBeNull();
      fireEvent.click(view.getByRole("button", { name: "Account menu" }));
      expect(view.queryByRole("menuitem", { name: "Account & settings" })).toBeNull();
      expect(view.queryByRole("menuitem", { name: "Preferences" })).toBeNull();
      expect(view.getByRole("menuitem", { name: "Sign out" })).toBeTruthy();
    } finally {
      view.unmount();
    }
  });
}
