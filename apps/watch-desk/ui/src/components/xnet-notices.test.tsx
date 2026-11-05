import "../route-registry";
import type { ReactNode } from "react";
import { test, expect, spyOn } from "bun:test";
import { fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderWithProviders } from "../test-utils/render";
import { SettingsContext } from "./settings-data";
import { XnetBanner, XnetMessageStatus } from "./xnet-notices";
import { NotificationPanel } from "./notifications";
import type { Command } from "./command-roster";
import { xnetTitle, type DeskNetwork, type XnetNotice } from "./xnet-data";
const notice: XnetNotice = {
  id: "opaque-notice", version: 2,
  payload: { shipId: "demo-meridian", count: 2, highestPrecedence: "IMMEDIATE", firstWaitingAt: "2026-11-05T14:12:00Z", latestWaitingAt: "2026-11-05T14:14:00Z" },
  sentAt: "2026-11-05T14:12:01Z", clearedAt: null, acknowledgedAt: null, unread: true,
};
const meridian: Command = { id: "demo-meridian", name: "USS Meridian", shortLabel: "MERIDIAN", group: "Fictional own ship", colorIndex: 0, isOwnShip: true };
const halyard: Command = { id: "demo-halyard", name: "USS Halyard", shortLabel: "HALYARD", group: "Fictional strike group", colorIndex: 1, isOwnShip: false };
const title = xnetTitle(notice, "USS Meridian");
function mount(desk: DeskNetwork, children: ReactNode, commands: Command[] = [meridian, halyard]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["watchdesk-commands"], { commands, source: "test", version: "test", provenance: "test", assignmentEnabled: false });
  client.setQueryData(["xnet", desk, "list"], { items: [notice] });
  client.setQueryData(["notifications", "watch", "list", ...(desk === "ALL" ? [] : [desk])], { pages: [{ items: [], unread: 0, watermark: 0, nextBefore: null, catchingUp: false }], pageParams: [null] });
  const view = renderWithProviders(<QueryClientProvider client={client}><SettingsContext.Provider value={{ timezone: "UTC", deskNetwork: desk }}>{children}</SettingsContext.Provider></QueryClientProvider>);
  return { ...view, client };
}
test("LOW banner shows a content-free prominent notice and acknowledgement result", async () => {
  let current = notice;
  const writes: object[] = [];
  const fetch = spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    if (String(input).endsWith("/acknowledge")) {
      writes.push(JSON.parse(String(init?.body)));
      current = { ...notice, acknowledgedAt: "2026-11-05T14:15:00Z", unread: false };
      return new Response(JSON.stringify({ saved: true }));
    }
    return new Response(JSON.stringify({ items: [current] }));
  });
  const view = mount("LOW", <XnetBanner />);
  try {
    expect(view.getByText(title)).toBeTruthy();
    expect(view.getByText(/not access control/)).toBeTruthy();
    expect(view.container.querySelector(".xnet-prominent")).toBeTruthy();
    expect(view.container.textContent).not.toContain("opaque-notice");
    fireEvent.click(view.getByRole("button", { name: "Acknowledge traffic notice for USS Meridian" }));
    await waitFor(() => expect(view.getByText("Acknowledged by you at 1415Z")).toBeTruthy());
    expect(writes).toEqual([{ shipId: "demo-meridian", id: "opaque-notice", version: 2 }]);
    expect(view.queryByRole("button", { name: /Acknowledge traffic/ })).toBeNull();
  } finally { view.unmount(); view.client.clear(); fetch.mockRestore(); }
});
test("bell counts notices and opening it does not acknowledge them", () => {
  const view = mount("LOW", <NotificationPanel identity="watch" />);
  try {
    fireEvent.click(view.getByRole("button", { name: "Notifications, 1 unread" }));
    expect(view.getByText(title)).toBeTruthy();
    expect(view.getByRole("button", { name: /Acknowledge traffic notice/ })).toBeTruthy();
    expect(view.getByRole("button", { name: "Mark all as read" })).toBeDisabled();
  } finally { view.unmount(); view.client.clear(); }
});
test("cleared history remains visible and routine notices stay quiet", async () => {
  const view = mount("LOW", <XnetBanner />);
  try {
    view.client.setQueryData(["xnet", "LOW", "list"], { items: [{ ...notice, payload: { ...notice.payload, highestPrecedence: "ROUTINE" }, clearedAt: "2026-11-05T14:30:00Z", unread: false }] });
    await waitFor(() => expect(view.getByText("Cleared traffic notice history")).toBeTruthy());
    expect(view.getByText("1430Z")).toBeTruthy();
    expect(view.container.querySelector(".xnet-prominent")).toBeNull();
    expect(view.container.querySelector(".xnet-quiet")).toBeTruthy();
    expect(view.queryByRole("button", { name: /Acknowledge traffic/ })).toBeNull();
  } finally { view.unmount(); view.client.clear(); }
});
test("LOW message opens do not copy; HIGH opens record copying and show acknowledgements", async () => {
  const writes: string[] = [];
  const fetch = spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    writes.push(String(input));
    return new Response(JSON.stringify(String(input).endsWith("/opened") ? { copied: true } : { items: [{ shipId: "demo-meridian", sentAt: notice.sentAt, clearedAt: null, version: 2, acknowledgements: [{ username: "dev-user", at: "2026-11-05T14:15:00Z", version: 2 }] }] }));
  });
  const low = mount("LOW", <XnetMessageStatus messageKey="one@r1" networks={["HIGH"]} />);
  try { expect(writes).toEqual([]); } finally { low.unmount(); low.client.clear(); }
  const high = mount("HIGH", <><XnetBanner /><XnetMessageStatus messageKey="one@r1" networks={["HIGH"]} /></>);
  try {
    await waitFor(() => expect(high.getByText(/acknowledged by dev-user at 1415Z/)).toBeTruthy());
    expect(high.getByText(/for USS Meridian · acknowledged by dev-user/)).toBeTruthy();
    expect(writes.some((url) => url.endsWith("/opened"))).toBe(true);
    expect(high.queryByText(title)).toBeNull();
  } finally { high.unmount(); high.client.clear(); fetch.mockRestore(); }
});
test("unknown ship IDs fall back to the raw ID in the banner, button name and message status", async () => {
  const unknownTitle = xnetTitle(notice);
  expect(unknownTitle).toContain("for demo-meridian ·");
  const low = mount("LOW", <XnetBanner />, [halyard]);
  try {
    expect(low.getByText(unknownTitle)).toBeTruthy();
    expect(low.queryByText(title)).toBeNull();
    expect(low.getByRole("button", { name: "Acknowledge traffic notice for demo-meridian" })).toBeTruthy();
  } finally { low.unmount(); low.client.clear(); }
  const fetch = spyOn(globalThis, "fetch").mockImplementation(async (input) => new Response(JSON.stringify(String(input).endsWith("/opened") ? { copied: true } : { items: [{ shipId: "demo-meridian", sentAt: notice.sentAt, clearedAt: null, version: 2, acknowledgements: [] }] })));
  const high = mount("HIGH", <XnetMessageStatus messageKey="one@r1" networks={["HIGH"]} />, [halyard]);
  try {
    await waitFor(() => expect(high.getByText(/for demo-meridian · not yet acknowledged/)).toBeTruthy());
    expect(high.container.textContent).not.toContain("USS Meridian");
  } finally { high.unmount(); high.client.clear(); fetch.mockRestore(); }
});
