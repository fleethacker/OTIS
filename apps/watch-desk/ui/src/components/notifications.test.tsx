import "../route-registry";
import { expect, test, spyOn } from "bun:test";
import { fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useLocation } from "react-router-dom";
import { renderWithProviders } from "../test-utils/render";
import { NotificationPanel } from "./notifications";
import {
  notificationTime,
  type DeskNotification,
  type NotificationPage,
} from "./notification-data";

const item: DeskNotification = {
  id: 1,
  version: 2,
  kind: "traffic",
  count: 1,
  context: "EXAMPLE · TRAINING",
  messageKey: "internal-key",
  at: "2026-11-04T22:30:00Z",
  detail: "",
  resolvedAt: null,
  unread: true,
};
function Location() {
  return <output aria-label="Current route">{useLocation().search}</output>;
}
function mount(page: NotificationPage, identity = "watch") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["notifications", identity, "list"], { pages: [page], pageParams: [null] });
  client.setQueryData(["xnet", "ALL", "list"], { items: [] });
  const view = renderWithProviders(
    <QueryClientProvider client={client}>
      <NotificationPanel identity={identity} />
      <Location />
    </QueryClientProvider>
  );
  return { ...view, client };
}
const page = (items: DeskNotification[]): NotificationPage => ({
  items,
  unread: items.filter((n) => n.unread).length,
  watermark: 2,
  nextBefore: null,
  catchingUp: false,
});

test("bell opens without marking read, hides internal identifiers, and Escape returns focus", () => {
  const view = mount(page([item]));
  const button = view.getByRole("button", { name: "Notifications, 1 unread" });
  fireEvent.click(button);
  expect(view.getByRole("heading", { name: "Notifications" })).toBeTruthy();
  expect(view.container.textContent).not.toContain("internal-key");
  expect(view.container.textContent).not.toContain("Daily reminder");
  expect(view.getByRole("button", { name: "Mark as read: New message received" })).toBeTruthy();
  expect(view.getByText("04 NOV 2026 2230Z")).toBeTruthy();
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  expect(view.queryByRole("heading", { name: "Notifications" })).toBeNull();
  expect(document.activeElement).toBe(button);
  expect(button.getAttribute("aria-expanded")).toBe("false");
});
test("opening an item persists its exact version then navigates; bulk read uses the displayed watermark", async () => {
  let current = page([item]);
  const writes: object[] = [];
  const fetch = spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    if (String(input).endsWith("/read")) {
      writes.push(JSON.parse(String(init?.body)));
      current = page([{ ...item, unread: false }]);
      return new Response(JSON.stringify({ saved: true }));
    }
    return new Response(JSON.stringify(current));
  });
  const view = mount(current);
  try {
    fireEvent.click(view.getByRole("button", { name: "Notifications, 1 unread" }));
    fireEvent.click(view.getByRole("button", { name: /New message received EXAMPLE/ }));
    await waitFor(() =>
      expect(view.getByLabelText("Current route").textContent).toContain("record=internal-key")
    );
    expect(writes).toEqual([{ id: 1, version: 2 }]);
    expect(view.getByRole("button", { name: "Notifications", exact: true })).toBeTruthy();
    current = page([item]);
    view.client.setQueryData(["notifications", "watch", "list"], {
      pages: [current],
      pageParams: [null],
    });
    await waitFor(() =>
      expect(view.getByRole("button", { name: "Notifications, 1 unread" })).toBeTruthy()
    );
    fireEvent.click(view.getByRole("button", { name: "Notifications, 1 unread" }));
    fireEvent.click(view.getByRole("button", { name: "Mark all as read" }));
    await waitFor(() => expect(writes).toHaveLength(2));
    expect(writes[1]).toEqual({ through: 2 });
  } finally {
    view.unmount();
    view.client.clear();
    fetch.mockRestore();
  }
});
test("group opens its messages, and a failed save keeps unread state with retry", async () => {
  const group = { ...item, count: 12, messageKey: "", unread: false };
  const fetch = spyOn(globalThis, "fetch").mockImplementation(
    async (input) =>
      new Response(
        JSON.stringify(
          String(input).endsWith("/members")
            ? {
                items: [
                  {
                    messageKey: "private-id",
                    subject: "Exercise tasking",
                    context: "EXAMPLE · TRAINING",
                    at: item.at,
                    version: 2,
                  },
                ],
                nextBefore: null,
              }
            : { message: "Unavailable" }
        ),
        { status: String(input).endsWith("/read") ? 503 : 200 }
      )
  );
  const view = mount(page([group]));
  try {
    fireEvent.click(view.getByRole("button", { name: "Notifications", exact: true }));
    fireEvent.click(view.getByRole("button", { name: /12 new messages received/ }));
    await waitFor(() => expect(view.getByRole("link", { name: /Exercise tasking/ })).toBeTruthy());
    expect(view.container.textContent).not.toContain("private-id");
    fireEvent.click(view.getByRole("button", { name: "Back to notifications" }));
    view.client.setQueryData(["notifications", "watch", "list"], {
      pages: [page([item])],
      pageParams: [null],
    });
    await waitFor(() =>
      expect(view.getByRole("button", { name: "Mark all as read" }).hasAttribute("disabled")).toBe(
        false
      )
    );
    fireEvent.click(view.getByRole("button", { name: "Mark all as read" }));
    await waitFor(() =>
      expect(view.getByRole("alert").textContent).toContain("Couldn't mark as read")
    );
    expect(view.getByRole("button", { name: "Notifications, 1 unread" })).toBeTruthy();
  } finally {
    view.unmount();
    view.client.clear();
    fetch.mockRestore();
  }
});
test("empty state has no zero badge or invented reminder and timestamps always use Zulu", () => {
  const view = mount(page([]));
  fireEvent.click(view.getByRole("button", { name: "Notifications", exact: true }));
  expect(view.getByText("You're up to date")).toBeTruthy();
  expect(view.container.querySelector(".notification-count")).toBeNull();
  expect(notificationTime("2026-11-04T16:30:00-06:00")).toBe("04 NOV 2026 2230Z");
});
