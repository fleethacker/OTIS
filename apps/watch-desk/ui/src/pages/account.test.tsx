import "../route-registry";
import { expect, spyOn, test } from "bun:test";
import { fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders, testSession } from "../test-utils/render";
import { AccountProfileProvider } from "../components/AccountProfileProvider";
import { DisplayTimeProvider, useDisplayTime } from "../components/display-time";
import type { AccountSettings } from "../components/session";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NotificationPanel } from "../components/notifications";
import Account from "./account";

test("saving narrower relevance refreshes notifications and removes previously matching traffic", async () => {
  let settings = testSession.settings;
  let reads = 0;
  const fetch = spyOn(globalThis, "fetch").mockImplementation(async (path, init) => {
    if (String(path).endsWith("/notifications/list")) {
      reads++;
      const items =
        settings.messageScope?.allCommands === false
          ? []
          : [
              {
                id: 1,
                version: 1,
                kind: "traffic",
                count: 1,
                context: "Other command review",
                messageKey: "sha256:old-command@r1",
                at: "2026-11-05T10:00:00Z",
                detail: "",
                resolvedAt: null,
                unread: false,
              },
            ];
      return new Response(
        JSON.stringify({ items, unread: 0, watermark: 1, nextBefore: null, catchingUp: false })
      );
    }
    if (String(path).endsWith("/responsibilities")) {
      return new Response(JSON.stringify({ items: [], messageTypes: [] }));
    }
    if (String(path).endsWith("/commands")) {
      return new Response(JSON.stringify({ commandIds: ["OTHER"], limited: false }));
    }
    if (String(path).endsWith("/settings")) {
      settings = JSON.parse(String(init?.body));
      return new Response(JSON.stringify(settings));
    }
    return new Response(JSON.stringify({ ...testSession, settings }));
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = renderWithProviders(
    <AccountProfileProvider>
      <QueryClientProvider client={client}>
        <NotificationPanel identity="scope-refresh" />
        <Account />
      </QueryClientProvider>
    </AccountProfileProvider>
  );
  try {
    await waitFor(() =>
      expect(view.getByRole("button", { name: "Notifications", exact: true })).toBeTruthy()
    );
    fireEvent.click(view.getByRole("button", { name: "Notifications", exact: true }));
    await waitFor(() =>
      expect(view.getByRole("button", { name: /Other command review/ })).toBeTruthy()
    );
    fireEvent.click(view.getByLabelText("All assigned commands"));
    fireEvent.click(view.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(view.getByText(/Settings saved/)).toBeTruthy());
    expect(reads).toBe(2);
    expect(view.queryByRole("button", { name: /Other command review/ })).toBeNull();
    await waitFor(() => expect(view.getByText("You're up to date")).toBeTruthy());
  } finally {
    view.unmount();
    client.clear();
    fetch.mockRestore();
  }
});

test("account shows stable ID and prior sign-in; saved preferences update the visible display", async () => {
  let settings = testSession.settings;
  const writes: AccountSettings[] = [];
  let fail = true;
  const fetch = spyOn(globalThis, "fetch").mockImplementation(async (path, init) => {
    if (String(path).endsWith("/responsibilities"))
      return new Response(JSON.stringify({ items: [], messageTypes: [] }));
    if (String(path).endsWith("/briefing/commands"))
      return new Response(JSON.stringify({ commandIds: [], limited: false }));
    if (String(path).endsWith("/settings")) {
      if (fail)
        return new Response(JSON.stringify({ message: "Temporarily unavailable" }), {
          status: 503,
        });
      settings = JSON.parse(String(init?.body)) as AccountSettings;
      writes.push(settings);
      return new Response(JSON.stringify(settings));
    }
    return new Response(JSON.stringify({ ...testSession, settings }));
  });
  function ClockLabel() {
    return <output aria-label="Clock display">{useDisplayTime().label}</output>;
  }
  const view = renderWithProviders(
    <AccountProfileProvider>
      <DisplayTimeProvider>
        <Account />
        <ClockLabel />
      </DisplayTimeProvider>
    </AccountProfileProvider>
  );
  try {
    await waitFor(() =>
      expect(view.getByRole("heading", { name: "Account & settings" })).toBeTruthy()
    );
    expect(view.getByText("test-user")).toBeTruthy();
    expect(view.getByText("No previous sign-in")).toBeTruthy();
    expect(view.getByText("2026-11-05 10:00:00 UTC")).toBeTruthy();
    fireEvent.change(view.getByLabelText("Display time"), {
      target: { value: "America/New_York" },
    });
    fireEvent.change(view.getByLabelText("Automatic refresh"), { target: { value: "60" } });
    fireEvent.change(view.getByLabelText("Default calendar view"), { target: { value: "week" } });
    fireEvent.click(view.getByRole("button", { name: "Save settings" }));
    await waitFor(() =>
      expect(view.getByRole("alert").textContent).toContain("Temporarily unavailable")
    );
    expect(view.getByLabelText("Display time")).toHaveValue("America/New_York");
    fail = false;
    fireEvent.click(view.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(view.getByText(/Settings saved/)).toBeTruthy());
    expect(writes).toEqual([
      { timezone: "America/New_York", calendarRefreshSeconds: 60, defaultCalendarView: "week" },
    ]);
    expect(view.getByLabelText("Clock display").textContent).toBe("America/New_York");
    expect(view.getByRole("button", { name: "Save settings" })).toBeDisabled();
  } finally {
    view.unmount();
    fetch.mockRestore();
  }
});
