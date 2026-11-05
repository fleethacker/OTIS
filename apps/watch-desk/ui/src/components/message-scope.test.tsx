import "../route-registry";
import { expect, spyOn, test } from "bun:test";
import { fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { renderWithProviders, testSession } from "../test-utils/render";
import { AccountProfileProvider } from "./AccountProfileProvider";
import { MessageScopeEditor } from "./message-scope";
import type { AccountSettings, MessageScope } from "./session";
import Account from "../pages/account";

test("scope settings retain saved unknown command IDs and persist an explicit empty selection", async () => {
  let settings: AccountSettings = {
    ...testSession.settings,
    messageScope: { allCommands: false, commandIds: ["SAVED-COMMAND"], includeUnassigned: true },
  };
  const writes: MessageScope[] = [];
  const fetch = spyOn(globalThis, "fetch").mockImplementation(async (path, init) => {
    if (String(path).endsWith("/responsibilities"))
      return new Response(JSON.stringify({ items: [], messageTypes: [] }));
    if (String(path).endsWith("/commands"))
      return new Response(JSON.stringify({ commandIds: ["COMMAND-A"], limited: true }));
    if (String(path).endsWith("/settings")) {
      settings = JSON.parse(String(init?.body)) as AccountSettings;
      writes.push(settings.messageScope!);
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
    await waitFor(() => expect(view.getByLabelText("COMMAND-A")).toBeTruthy());
    expect(view.getByLabelText(/SAVED-COMMAND/)).toBeChecked();
    expect(view.getByText(/source limit/)).toBeTruthy();
    fireEvent.click(view.getByLabelText("COMMAND-A"));
    fireEvent.click(view.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toEqual({
      allCommands: false,
      commandIds: ["SAVED-COMMAND", "COMMAND-A"],
      includeUnassigned: true,
    });
    await waitFor(() => expect(view.getByRole("button", { name: "Save settings" })).toBeDisabled());
    fireEvent.click(view.getByLabelText(/SAVED-COMMAND/));
    fireEvent.click(view.getByLabelText("COMMAND-A"));
    fireEvent.click(view.getByLabelText("Include messages with no assigned command"));
    expect(
      view.getByText("This selection will show no messages in your shift briefing.")
    ).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(writes).toHaveLength(2));
    expect(writes[1]).toEqual({ allCommands: false, commandIds: [], includeUnassigned: false });
  } finally {
    view.unmount();
    client.clear();
    fetch.mockRestore();
  }
});

test("unavailable command options keep saved selections visible and never broaden scope", async () => {
  const fetch = spyOn(globalThis, "fetch").mockImplementation(async (path) =>
    String(path).endsWith("/responsibilities")
      ? new Response(JSON.stringify({ items: [], messageTypes: [] }))
      : new Response(JSON.stringify({ message: "Unavailable" }), { status: 503 })
  );
  let changed = false;
  function Editor() {
    const [scope, setScope] = useState<MessageScope>({
      allCommands: false,
      commandIds: ["KEEP-COMMAND"],
      includeUnassigned: false,
    });
    return (
      <MessageScopeEditor
        scope={scope}
        userId="isolated-options-user"
        disabled={false}
        onChange={(value) => {
          changed = true;
          setScope(value);
        }}
      />
    );
  }
  const view = renderWithProviders(<Editor />);
  try {
    await waitFor(() =>
      expect(view.getByRole("alert").textContent).toContain("Saved selections are retained")
    );
    expect(view.getByLabelText(/KEEP-COMMAND/)).toBeChecked();
    expect(view.getByLabelText("All assigned commands")).not.toBeChecked();
    expect(view.getByLabelText("Include messages with no assigned command")).not.toBeChecked();
    expect(changed).toBe(false);
  } finally {
    view.unmount();
    fetch.mockRestore();
  }
});
