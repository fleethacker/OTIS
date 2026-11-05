import { test, expect, spyOn } from "bun:test";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { createRouterTransport } from "@connectrpc/connect";
import { TransportProvider } from "@connectrpc/connect-query";
import { AppService } from "../gen/app/v1/app_pb";
import { renderWithProviders } from "../test-utils/render";
import { SettingsContext, type SettingsReply } from "../components/settings-data";
import Settings from "./settings";
import {
  initializeTheme,
  STYLE_STORAGE_KEY,
  THEME_STORAGE_KEY,
  themeName,
  windowsThemeName,
} from "../theme";
import { WatchContextHeader } from "../components/watch-context-header";
import { SettingsProvider } from "../components/SettingsProvider";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WatchSessionUpdateContext, type WatchPin } from "../components/watch-session";
import { formatSinceUTC } from "../components/watch-boundary";
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
    turnoverUtc: ["0000Z", "1200Z"],
    defaultShips: [],
    operationName: "",
    groupCommand: "",
  },
};
const emptyRoster = { commands: [], source: "none", version: "test", provenance: "test", assignmentEnabled: false };
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
  const fetch = spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    // The watch fields read the ship roster; it is not a settings write.
    if (String(input).endsWith("/commands/list")) return Response.json(emptyRoster);
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
    expect(view.getByLabelText("Ship display name").closest("fieldset")?.disabled).toBe(true);
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
    if (String(input).endsWith("/commands/list")) return Response.json(emptyRoster);
    if (String(input).endsWith("/suggestions"))
      return Response.json({ suggestions: [], state: "available", limited: false, revision: "1:1" });
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
    fireEvent.change(view.getByLabelText("Ship display name"), { target: { value: "CHANGED SHIP" } });
    fireEvent.click(view.getByRole("button", { name: "Save", exact: true }));
    await waitFor(() => expect(view.getByRole("alert").textContent).toContain("reload"));
    expect(saved.revision).toBe("1:1");
    expect(view.getByText("Unsaved")).toBeTruthy();
    expect((view.getByLabelText("Ship display name") as HTMLInputElement).value).toBe("CHANGED SHIP");
  } finally {
    view.unmount();
    fetch.mockRestore();
  }
});

test("browser appearance applies immediately without submitting or dirtying timezone settings", () => {
  localStorage.setItem(THEME_STORAGE_KEY, themeName);
  localStorage.removeItem(STYLE_STORAGE_KEY);
  initializeTheme();
  const fetch = spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
  const view = mount("viewer");
  try {
    const style = view.getByRole("combobox", { name: "Interface style (this browser)" });
    expect(style.closest("form")).toBeNull();
    fireEvent.change(style, { target: { value: "windows" } });
    expect(document.documentElement.getAttribute("data-theme")).toBe(windowsThemeName);
    expect(view.getByLabelText("Timezone")).toHaveValue("UTC");
    expect(view.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
    expect(view.queryByText("Unsaved")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    view.unmount();
    fetch.mockRestore();
    localStorage.removeItem(THEME_STORAGE_KEY);
    localStorage.removeItem(STYLE_STORAGE_KEY);
    initializeTheme();
  }
});

const roster = {
  commands: [
    { id: "demo-meridian", name: "USS Meridian", shortLabel: "MERIDIAN", group: "Fictional", colorIndex: 0, isOwnShip: true },
    { id: "demo-tern", name: "USNS Tern", shortLabel: "TERN", group: "Fictional", colorIndex: 2, isOwnShip: false },
  ],
  source: "fictional", version: "test", provenance: "fictional test", assignmentEnabled: true,
};
const citation = { messageKey: `sha256:${"a".repeat(64)}@fictional-r1`, auditId: "fictional-audit", setId: "EXER",
  recordedAt: "2026-11-05T00:00:00Z", startByte: 10, endByte: 20, lineStart: 2, lineEnd: 2 };
function watch(role: string, settings: Partial<SettingsReply["settings"]> = {}, demo = true) {
  const reply: SettingsReply = { revision: "7:1", settings: { ...shared.settings, ...settings } };
  const requests: { url: string; body: Record<string, unknown> }[] = [];
  const pins: WatchPin[] = [];
  const fetch = spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body ?? "{}"));
    if (url.endsWith("/commands/list")) return Response.json({ ...roster, assignmentEnabled: demo });
    if (url.endsWith("/settings/get")) return Response.json(reply);
    if (url.endsWith("/settings/preferences")) return Response.json({ timezone: "UTC" });
    if (url.endsWith("/options")) return Response.json({ commands: ["demo-meridian", "demo-tern"], aiEndpoints: [], secretRefs: [] });
    if (url.endsWith("/suggestions")) return Response.json({ revision: reply.revision, state: "available", limited: false, suggestions: [
      { id: "context:copper", field: "operationName", values: ["FICTIONAL COPPER"], sources: [citation, { ...citation, auditId: "other", lineEnd: 4 }] },
      { id: "context:slate", field: "operationName", values: ["FICTIONAL SLATE"], sources: [citation] },
    ] });
    requests.push({ url, body });
    if (url.endsWith("/changes/demo-reset")) return Response.json({ lastSeenAt: "2026-11-05T06:00:00.000Z", since: "2026-11-05T06:00:00.000Z", basis: "last_seen", reviewsCleared: true });
    if (url.endsWith("/use-suggestion")) return Response.json({ revision: "8:1", settings: { ...reply.settings, operationName: "FICTIONAL COPPER" } });
    if (url.endsWith("/dismiss-suggestion")) return Response.json({ revision: "8:1", settings: reply.settings });
    if (url.endsWith("/update")) return Response.json({ revision: "8:1", settings: body.settings });
    throw new Error(`Unexpected test request ${url}`);
  });
  const transport = createRouterTransport((router) =>
    router.service(AppService, { getIdentity: () => ({ username: "watch", role }) })
  );
  // Fresh query cache: roster and suggestion reads must not leak between tests.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = renderWithProviders(
    <TransportProvider transport={transport}>
      <QueryClientProvider client={client}>
        <WatchSessionUpdateContext.Provider value={(pin) => pins.push(pin)}>
          <SettingsProvider>
            <WatchContextHeader />
            <Settings />
          </SettingsProvider>
        </WatchSessionUpdateContext.Provider>
      </QueryClientProvider>
    </TransportProvider>
  );
  return { view, requests, pins, client, close: () => { view.unmount(); client.clear(); fetch.mockRestore(); } };
}
test("Header shows own ship and operation from shared settings", async () => {
  const { view, close } = watch("viewer", { shipName: "", commandIds: ["demo-meridian"], operationName: "FICTIONAL COPPER" });
  try {
    await waitFor(() => expect(view.getByRole("link", { name: "USS Meridian · FICTIONAL COPPER" })).toBeTruthy());
  } finally { close(); }
  const unset = watch("viewer");
  try {
    await waitFor(() => expect(unset.view.getByRole("link", { name: "EXAMPLE SHIP · Operation not set" })).toBeTruthy());
  } finally { unset.close(); }
});
test("Viewer sees watch fields read-only with Not set and no suggestions", async () => {
  const { view, requests, close } = watch("viewer");
  try {
    await waitFor(() => expect(view.getByRole("button", { name: "Command", exact: true })).toBeTruthy());
    fireEvent.click(view.getByRole("button", { name: "Command", exact: true }));
    const operation = view.getByLabelText("Operation / exercise") as HTMLInputElement;
    expect(operation.closest("fieldset")?.disabled).toBe(true);
    expect(operation.placeholder).toBe("Not set");
    expect(view.getByText(/Not set: every ship is shown/)).toBeTruthy();
    for (const label of ["Own ship", "Group / command", "UTC watch turnovers"]) {
      expect(view.getByLabelText(label).closest("fieldset")?.disabled).toBe(true);
    }
    for (const checkbox of view.getAllByRole("checkbox")) {
      expect(checkbox.closest("fieldset")?.disabled).toBe(true);
    }
    expect(view.queryByRole("button", { name: "Save", exact: true })).toBeNull();
    expect(view.queryByRole("region", { name: "Source suggestions" })).toBeNull();
    expect(view.queryByText(/last-write-wins|watchdesk-demo\.json/)).toBeNull();
    expect(requests).toEqual([]);
  } finally { close(); }
});
test("Admin saves watch fields through the revisioned settings update", async () => {
  const { view, requests, close } = watch("admin", { commandIds: ["demo-tern", "demo-meridian"] });
  try {
    await waitFor(() => expect(view.getByRole("button", { name: "Command", exact: true })).toBeTruthy());
    fireEvent.click(view.getByRole("button", { name: "Command", exact: true }));
    await waitFor(() => expect(view.getByRole("checkbox", { name: "USNS Tern" })).toBeTruthy());
    const own = view.getByLabelText("Own ship");
    const display = view.getByLabelText("Ship display name");
    expect(own.closest("label")?.nextElementSibling).toBe(display.closest("label"));
    expect(own.tagName).toBe("SELECT");
    expect(display.tagName).toBe("INPUT");
    const calendars = within(view.getByRole("group", { name: "Calendar commands" }));
    expect(calendars.getByRole("checkbox", { name: "USS Meridian demo-meridian" })).toBeTruthy();
    expect(calendars.getByText("demo-meridian").tagName).toBe("SMALL");
    fireEvent.change(own, { target: { value: "demo-meridian" } });
    fireEvent.change(display, { target: { value: "WATCH DISPLAY" } });
    fireEvent.change(view.getByLabelText("Operation / exercise"), { target: { value: "FICTIONAL SLATE" } });
    fireEvent.change(view.getByLabelText("Group / command"), { target: { value: "FICTIONAL GROUP" } });
    fireEvent.change(view.getByLabelText("UTC watch turnovers"), { target: { value: "1600z, 0400Z 0400Z" } });
    fireEvent.click(view.getByRole("checkbox", { name: "USNS Tern" }));
    fireEvent.click(view.getByRole("checkbox", { name: "Unassigned / needs applicability review" }));
    expect(view.getByText("Unsaved")).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Save", exact: true }));
    await waitFor(() => expect(requests.length).toBe(1));
    const sent = requests[0];
    expect(sent.url).toEndWith("/settings/update");
    expect(sent.body.revision).toBe("7:1");
    expect(sent.body.settings).toMatchObject({
      shipName: "WATCH DISPLAY", commandIds: ["demo-meridian", "demo-tern"], operationName: "FICTIONAL SLATE", groupCommand: "FICTIONAL GROUP",
      turnoverUtc: ["0400Z", "1600Z"], defaultShips: ["unassigned:", "unit:demo-tern"],
    });
    await waitFor(() => expect(view.getByRole("status").textContent).toBe("Saved"));
  } finally { close(); }
});
test("Admin Use and Dismiss send the suggestion with the settings revision", async () => {
  const { view, requests, close } = watch("admin");
  try {
    await waitFor(() => expect(view.getByRole("button", { name: "Command", exact: true })).toBeTruthy());
    fireEvent.click(view.getByRole("button", { name: "Command", exact: true }));
    await waitFor(() => expect(view.getByRole("button", { name: "Use FICTIONAL COPPER" })).toBeTruthy());
    expect(view.getByText("Different names were found. Choose the one for this watch.")).toBeTruthy();
    expect(view.getAllByRole("link", { name: "EXER message · line 2" }).length).toBeGreaterThan(0);
    expect(view.getByRole("link", { name: "EXER message · lines 2–4" })).toBeTruthy();
    expect(view.getByRole("button", { name: "Refresh" }).className).toContain("btn");
    fireEvent.click(view.getByRole("button", { name: "Use FICTIONAL COPPER" }));
    await waitFor(() => expect(requests.length).toBe(1));
    expect(requests[0]).toEqual({ url: "/api/v1/settings/use-suggestion", body: { suggestion: "context:copper", revision: "7:1" } });
    await waitFor(() => expect((view.getByLabelText("Operation / exercise") as HTMLInputElement).value).toBe("FICTIONAL COPPER"));
    const dismiss = view.getByRole("button", { name: "Dismiss FICTIONAL SLATE" });
    expect(dismiss).toHaveClass("btn", "btn-sm", "context-suggestion-dismiss");
    fireEvent.click(dismiss);
    await waitFor(() => expect(requests.length).toBe(2));
    expect(requests[1]).toEqual({ url: "/api/v1/settings/dismiss-suggestion", body: { suggestion: "context:slate", revision: "8:1" } });
    fireEvent.change(view.getByLabelText("Group / command"), { target: { value: "EDIT" } });
    expect((view.getByRole("button", { name: "Use FICTIONAL COPPER" }) as HTMLButtonElement).disabled).toBe(true);
  } finally { close(); }
});
test("Demo reset section is hidden unless the server reports the demo flag", async () => {
  const { view, client, close } = watch("viewer", {}, false);
  try {
    await waitFor(() => expect(client.getQueryData(["watchdesk-commands"])).toBeTruthy());
    expect(view.getByLabelText("Timezone")).toBeTruthy();
    expect(view.queryByRole("button", { name: "Reset my catch-up" })).toBeNull();
    expect(view.queryByRole("region", { name: "Demo" })).toBeNull();
  } finally { close(); }
});
test("Viewer and admin reset only their own catch-up with the default, turnover or a UTC time", async () => {
  for (const role of ["viewer", "admin"]) {
    const { view, requests, pins, client, close } = watch(role);
    const invalidate = spyOn(client, "invalidateQueries");
    try {
      const reset = await waitFor(() => view.getByRole("button", { name: "Reset my catch-up" }));
      expect(reset).toHaveClass("btn", "btn-sm");
      expect(view.getByRole("region", { name: "Demo" }).textContent).toContain("Clears your reviews and sets 'since you were last here' to the chosen time. Demo only.");
      expect((view.getByRole("radio", { name: "0600Z today" }) as HTMLInputElement).checked).toBe(true);
      fireEvent.click(reset);
      await waitFor(() => expect(view.getByText("Catch-up reset to 05 NOV 2026 0600Z")).toBeTruthy());
      // No actor, user or role: the server resets the signed-in caller.
      expect(requests).toEqual([{ url: "/api/v1/changes/demo-reset", body: {} }]);
      expect(pins).toEqual([{ since: "2026-11-05T06:00:00.000Z", basis: "last_seen" }]);
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["watchdesk-changes"] });
      fireEvent.click(view.getByRole("radio", { name: "Latest turnover" }));
      fireEvent.click(view.getByRole("button", { name: "Reset my catch-up" }));
      await waitFor(() => expect(requests.length).toBe(2));
      expect(requests[1].body).toEqual({ lastSeenAt: "turnover" });
      const minute = Math.floor((Date.now() - 2 * 3600_000) / 60_000) * 60_000;
      fireEvent.change(view.getByLabelText("UTC time"), { target: { value: formatSinceUTC(minute) } });
      expect((view.getByRole("radio", { name: "Specific time" }) as HTMLInputElement).checked).toBe(true);
      fireEvent.click(view.getByRole("button", { name: "Reset my catch-up" }));
      await waitFor(() => expect(requests.length).toBe(3));
      expect(requests[2].body).toEqual({ lastSeenAt: new Date(minute).toISOString() });
    } finally { close(); }
  }
});
test("Demo reset checks the UTC time before sending and shows server errors", async () => {
  const { view, requests, pins, close } = watch("viewer");
  try {
    await waitFor(() => expect(view.getByRole("button", { name: "Reset my catch-up" })).toBeTruthy());
    for (const [value, message] of [["31 NOV 2026 1600Z", "valid UTC"], ["01 JAN 9000 0000Z", "not in the future"], ["01 JAN 2020 0000Z", "last 42 days"]]) {
      fireEvent.change(view.getByLabelText("UTC time"), { target: { value } });
      fireEvent.click(view.getByRole("button", { name: "Reset my catch-up" }));
      await waitFor(() => expect(view.getByRole("alert").textContent).toContain(message));
    }
    expect(requests).toEqual([]);
    expect(pins).toEqual([]);
    expect(view.queryByText(/Catch-up reset to/)).toBeNull();
  } finally { close(); }
});
