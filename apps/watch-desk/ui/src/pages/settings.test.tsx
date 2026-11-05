import "../route-registry";
import { expect, spyOn, test } from "bun:test";
import { act, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRouterTransport } from "@connectrpc/connect";
import { TransportProvider } from "@connectrpc/connect-query";
import { AppService } from "../gen/app/v1/app_pb";
import { renderWithProviders } from "../test-utils/render";
import { WatchContextHeader } from "../components/watch-context-header";
import type { ContextResponse, ContextUpdate } from "../components/watch-context";
import Settings from "./settings";

function setup(role = "platform_admin", denyWrites = false, missingSources = false, demo = true) {
  const source = { messageKey: `sha256:${"a".repeat(64)}@fictional-r1`, auditId: "fictional-audit", setId: "EXER", recordedAt: "2026-11-05T00:00:00Z", startByte: 10, endByte: 20, lineStart: 2, lineEnd: 2 };
  const data: ContextResponse = {
    context: { ownShipId: demo ? "demo-meridian" : "", shipName: "", operationName: "", groupCommand: "", defaultShips: demo ? ["unit:demo-meridian", "unassigned:"] : ["unassigned:"], turnoverUtc: ["0000Z", "0400Z"] },
    demoRoster: demo,
    confirmations: {}, updatedBy: null, updatedAt: null, canEdit: role === "platform_admin",
    suggestions: [{ id: "context:fictional-copper", field: "operationName", values: ["FICTIONAL COPPER"], sources: missingSources ? undefined : [source, { ...source, messageKey: `sha256:${"b".repeat(64)}@fictional-r1`, auditId: "fictional-other", lineEnd: 4 }] }],
    suggestionState: "available", suggestionsLimited: false, suggestionScope: "Bounded fictional metadata", defaultsSource: "backend/config/watchdesk-demo.json",
  };
  const requests: ContextUpdate[] = [];
  const contextReads: { includeSuggestions?: boolean }[] = [];
  const fetch = spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    if (String(url).endsWith("/commands/list")) return Response.json({ commands: demo ? [{ id: "demo-meridian", name: "USS Meridian", shortLabel: "MERIDIAN", group: "Fictional", colorIndex: 0, isOwnShip: true }] : [], source: "fictional test config", version: "test", provenance: "fictional test", assignmentEnabled: demo, defaultShips: data.context.defaultShips });
    if (String(url).endsWith("/watch-context/update")) {
      const request: ContextUpdate = JSON.parse(String(init?.body));
      requests.push(request);
      if (denyWrites) return Response.json({ code: "permission_denied", message: "Platform administrator permission is required" }, { status: 403 });
      if (request.suggestionId) {
        if (request.dismiss) data.suggestions = [];
        else {
          data.context.operationName = "FICTIONAL COPPER";
          data.confirmations.operationName = { actor: "dev-admin", recordedAt: source.recordedAt, sources: [source], confirmedHideUnassigned: false };
        }
      } else for (const change of request.changes ?? []) {
        if (change.field === "defaultShips" || change.field === "turnoverUtc") data.context[change.field] = change.values;
        else data.context[change.field] = change.values[0];
      }
      data.updatedBy = "dev-admin"; data.updatedAt = source.recordedAt;
      return Response.json(data);
    }
    if (String(url).endsWith("/watch-context/get")) {
      contextReads.push(JSON.parse(String(init?.body)));
      return Response.json(data);
    }
    throw new Error("Unexpected test request");
  });
  const transport = createRouterTransport((router) => router.service(AppService, { getIdentity: () => ({ username: role === "platform_admin" ? "dev-admin" : "dev-user", role, email: "fictional@invalid" }) }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = renderWithProviders(<TransportProvider transport={transport}><QueryClientProvider client={client}><WatchContextHeader /><Settings /></QueryClientProvider></TransportProvider>, { route: "/settings?returnTo=%2Fcalendar%3Fdate%3D2026-11-05%26shipLayout%3Dside" });
  return { view, requests, contextReads, client, close: () => { view.unmount(); client.clear(); fetch.mockRestore(); } };
}

test("demo-off header and Settings do not imply a fictional own ship", async () => {
  const { view, client, close } = setup("user", false, false, false);
  try {
    await waitFor(() => expect(view.getByRole("link", { name: "Own ship not set · Operation not set · Defaults" })).toBeTruthy());
    await waitFor(() => expect(client.isFetching()).toBe(0));
    expect(view.queryByRole("option", { name: "USS Meridian" })).toBeNull();
    expect(view.queryByText("Demo defaults")).toBeNull();
  } finally { close(); }
});

test("Refresh is a button that reloads settings and suggestions without a write", async () => {
  const { view, requests, contextReads, client, close } = setup("user");
  try {
    await waitFor(() => expect(view.getByText("Demo defaults")).toBeTruthy());
    await waitFor(() => expect(client.isFetching()).toBe(0));
    const refresh = view.getByRole("button", { name: "Refresh settings" });
    expect(refresh).toHaveClass("btn", "btn-sm", "settings-refresh");
    expect(refresh).toHaveAttribute("type", "button");
    expect(refresh).not.toBeDisabled();
    const before = contextReads.filter((request) => request.includeSuggestions).length;
    await act(async () => { fireEvent.click(refresh); });
    await waitFor(() => expect(contextReads.filter((request) => request.includeSuggestions).length).toBeGreaterThan(before));
    await waitFor(() => expect(client.isFetching()).toBe(0));
    expect(requests).toHaveLength(0);
  } finally { close(); }
});

test("Settings uses plain copy and compact provenance without exposing configuration or revision IDs", async () => {
  const { view, client, close } = setup("user");
  try {
    await waitFor(() => expect(view.getByText("View only. A platform administrator can change these settings.")).toBeTruthy());
    await waitFor(() => expect(client.isFetching()).toBe(0));
    const settings = view.getByRole("region", { name: "Watch settings" });
    const badge = within(settings).getByText("Demo defaults");
    expect(badge).toHaveClass("settings-defaults");
    expect(badge).toHaveAttribute("title", "backend/config/watchdesk-demo.json");
    for (const internal of ["backend/config/", "last-write-wins", "not tasking", "access control", "acknowledgement authority", "sha256:", "fictional-r1"]) {
      expect(settings.textContent).not.toContain(internal);
    }
    expect(within(settings).getByRole("heading", { name: "Suggestions from messages" })).toBeTruthy();
  } finally { close(); }
});

test("empty view-only fields show Not set without replacing stored values", async () => {
  const { view, requests, client, close } = setup("user");
  try {
    await waitFor(() => expect(view.getByLabelText("Display ship name")).toBeDisabled());
    await waitFor(() => expect(client.isFetching()).toBe(0));
    for (const label of ["Display ship name", "Operation / exercise", "Group / command"]) {
      const input = view.getByLabelText(label);
      expect(input).toBeDisabled();
      expect(input).toHaveValue("");
      expect(input).toHaveAttribute("placeholder", "Not set");
    }
    expect(view.getByLabelText("Own ship")).toHaveValue("demo-meridian");
    expect(view.getByLabelText("UTC watch turnovers")).toHaveValue("0000Z, 0400Z");
    expect(view.getByRole("button", { name: "Save settings" })).toBeDisabled();
    expect(requests).toHaveLength(0);
  } finally { close(); }
});

test("Use sends only a group ID and renders confirmed context/citations; Dismiss removes the group", async () => {
  const { view, requests, close } = setup();
  try {
    await waitFor(() => expect(view.getByRole("button", { name: "Use FICTIONAL COPPER" })).not.toBeDisabled());
    const use = view.getByRole("button", { name: "Use FICTIONAL COPPER" });
    const dismiss = view.getByRole("button", { name: "Dismiss FICTIONAL COPPER" });
    expect(use.textContent).toBe("Use");
    expect(dismiss.textContent).toBe("Dismiss");
    expect(use).toHaveClass("btn", "btn-sm", "btn-primary", "context-suggestion-use");
    expect(dismiss).toHaveClass("btn", "btn-sm", "btn-outline", "context-suggestion-dismiss");
    expect(use).toHaveAttribute("aria-label", "Use FICTIONAL COPPER");
    expect(dismiss).toHaveAttribute("aria-label", "Dismiss FICTIONAL COPPER");
    expect(view.getByText("+1 more sources")).toBeTruthy();
    expect(view.container.textContent).toContain("EXER message · lines 2–4");
    expect(view.container.textContent).not.toContain("lines 2–2");
    const source = view.getAllByRole("link", { name: "EXER message · line 2" })[0];
    expect(source.getAttribute("title")).toContain(`sha256:${"a".repeat(64)}@fictional-r1`);
    expect(new URL(source.getAttribute("href")!, "http://localhost").searchParams.get("record")).toBe(`sha256:${"a".repeat(64)}@fictional-r1`);
    await act(async () => { fireEvent.click(view.getByRole("button", { name: "Use FICTIONAL COPPER" })); });
    await waitFor(() => expect(view.getByLabelText("Operation / exercise")).toHaveValue("FICTIONAL COPPER"));
    expect(requests[0]).toEqual({ suggestionId: "context:fictional-copper" });
    expect(view.getByText(/matches current/)).toBeTruthy();
    expect(view.getByText(/Confirmed by dev-admin/)).toBeTruthy();
    expect(view.getByRole("link", { name: /USS Meridian · FICTIONAL COPPER/ })).toBeTruthy();
    await act(async () => { fireEvent.click(view.getByRole("button", { name: "Dismiss FICTIONAL COPPER" })); });
    await waitFor(() => expect(view.queryByRole("button", { name: "Use FICTIONAL COPPER" })).toBeNull());
    expect(requests[1]).toEqual({ suggestionId: "context:fictional-copper", dismiss: true });
  } finally { close(); }
});

test("one save batches changed fields; Cancel resets without a write", async () => {
  const { view, requests, close } = setup();
  try {
    await waitFor(() => expect(view.getByLabelText("Display ship name")).not.toBeDisabled());
    expect(view.getAllByRole("form", { name: "Watch settings" })).toHaveLength(1);
    expect(within(view.getByRole("form", { name: "Watch settings" })).getAllByRole("group")).toHaveLength(6);
    expect(view.getAllByRole("button", { name: "Save settings" })).toHaveLength(1);
    expect(view.getByRole("button", { name: "Save settings" })).toBeDisabled();
    await act(async () => {
      fireEvent.change(view.getByLabelText("Display ship name"), { target: { value: "DISPLAY" } });
      fireEvent.change(view.getByLabelText("Group / command"), { target: { value: "GROUP" } });
      fireEvent.change(view.getByLabelText("UTC watch turnovers"), { target: { value: "0000Z, 0600Z" } });
    });
    expect(view.getByText("Unsaved changes")).toBeTruthy();
    expect(view.getByRole("button", { name: "Use FICTIONAL COPPER" })).toBeDisabled();
    await act(async () => { fireEvent.click(view.getByRole("button", { name: "Save settings" })); });
    await waitFor(() => expect(view.getByText("No unsaved changes")).toBeTruthy());
    expect(requests).toEqual([{ changes: [
      { field: "shipName", values: ["DISPLAY"] },
      { field: "groupCommand", values: ["GROUP"] },
      { field: "turnoverUtc", values: ["0000Z", "0600Z"] },
    ] }]);
    await act(async () => { fireEvent.change(view.getByLabelText("Display ship name"), { target: { value: "discard me" } }); });
    await act(async () => { fireEvent.click(view.getByRole("button", { name: "Cancel changes" })); });
    expect(view.getByLabelText("Display ship name")).toHaveValue("DISPLAY");
    expect(requests).toHaveLength(1);
  } finally { close(); }
});

test("Unassigned defaults require explicit manual confirmation in the actual request", async () => {
  const { view, requests, close } = setup();
  try {
    await waitFor(() => expect(view.getByRole("checkbox", { name: "Unassigned / needs applicability review" })).not.toBeDisabled());
    await act(async () => { fireEvent.click(view.getByRole("checkbox", { name: "Unassigned / needs applicability review" })); });
    expect(view.getByRole("button", { name: "Save settings" })).toBeDisabled();
    await act(async () => { fireEvent.click(view.getByRole("checkbox", { name: "I confirm hiding Unassigned from the default ship list." })); });
    await act(async () => { fireEvent.click(view.getByRole("button", { name: "Save settings" })); });
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]).toEqual({ changes: [{ field: "defaultShips", values: ["unit:demo-meridian"], confirmHideUnassigned: true }] });
    await waitFor(() => expect(view.queryByRole("checkbox", { name: "I confirm hiding Unassigned from the default ship list." })).toBeNull());
  } finally { close(); }
});

test("user is read-only, missing citation arrays do not crash, and revoked writes retain the draft", async () => {
  const reader = setup("user", false, true);
  try {
    await waitFor(() => expect(reader.view.getByText("View only. A platform administrator can change these settings.")).toBeTruthy());
    expect(reader.view.getByRole("button", { name: "Save settings" })).toBeDisabled();
    expect(reader.view.getByRole("button", { name: "Use FICTIONAL COPPER" })).toBeDisabled();
    expect(reader.view.getByRole("button", { name: "Dismiss FICTIONAL COPPER" })).toBeDisabled();
    expect(reader.view.getByText("Source unavailable")).toBeTruthy();
    expect(reader.requests).toHaveLength(0);
  } finally { reader.close(); }
  const admin = setup("platform_admin", true);
  try {
    await waitFor(() => expect(admin.view.getByLabelText("Display ship name")).not.toBeDisabled());
    await act(async () => { fireEvent.change(admin.view.getByLabelText("Display ship name"), { target: { value: "Fictional display override" } }); });
    await act(async () => { fireEvent.click(admin.view.getByRole("button", { name: "Save settings" })); });
    await waitFor(() => expect(admin.view.getByRole("alert").textContent).toContain("Platform administrator"));
    expect(admin.view.getByLabelText("Display ship name")).toHaveValue("Fictional display override");
  } finally { admin.close(); }
});
