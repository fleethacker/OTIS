import "../route-registry";
import { expect, spyOn, test } from "bun:test";
import { act, fireEvent, waitFor } from "@testing-library/react";
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
    suggestions: [{ id: "context:fictional-copper", field: "operationName", values: ["FICTIONAL COPPER"], sources: missingSources ? undefined : [source, { ...source, messageKey: `sha256:${"b".repeat(64)}@fictional-r1`, auditId: "fictional-other" }] }],
    suggestionState: "available", suggestionsLimited: false, suggestionScope: "Bounded fictional metadata", defaultsSource: "fictional config",
  };
  const requests: ContextUpdate[] = [];
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
      } else if (request.field === "defaultShips") data.context.defaultShips = request.values!;
      else if (request.field === "shipName") data.context.shipName = request.values![0];
      data.updatedBy = "dev-admin"; data.updatedAt = source.recordedAt;
      return Response.json(data);
    }
    if (String(url).endsWith("/watch-context/get")) return Response.json(data);
    throw new Error("Unexpected test request");
  });
  const transport = createRouterTransport((router) => router.service(AppService, { getIdentity: () => ({ username: role === "platform_admin" ? "dev-admin" : "dev-user", role, email: "fictional@invalid" }) }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = renderWithProviders(<TransportProvider transport={transport}><QueryClientProvider client={client}><WatchContextHeader /><Settings /></QueryClientProvider></TransportProvider>, { route: "/settings?returnTo=%2Fcalendar%3Fdate%3D2026-11-05%26shipLayout%3Dside" });
  return { view, requests, client, close: () => { view.unmount(); client.clear(); fetch.mockRestore(); } };
}

test("demo-off header and Settings do not imply a fictional own ship", async () => {
  const { view, client, close } = setup("user", false, false, false);
  try {
    await waitFor(() => expect(view.getByRole("link", { name: "Own ship not set · Operation not set · Defaults" })).toBeTruthy());
    await waitFor(() => expect(client.isFetching()).toBe(0));
    expect(view.queryByRole("option", { name: "USS Meridian" })).toBeNull();
    expect(view.queryByText(/Unconfirmed demo defaults/)).toBeNull();
  } finally { close(); }
});

test("Use sends only a group ID and renders confirmed context/citations; Dismiss removes the group", async () => {
  const { view, requests, close } = setup();
  try {
    await waitFor(() => expect(view.getByRole("button", { name: "Use FICTIONAL COPPER" })).not.toBeDisabled());
    expect(view.getByText("+1 more sources")).toBeTruthy();
    const source = view.getAllByRole("link", { name: /EXER · sha256:/ })[0];
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

test("Unassigned defaults require explicit manual confirmation in the actual request", async () => {
  const { view, requests, close } = setup();
  try {
    await waitFor(() => expect(view.getByRole("checkbox", { name: "Unassigned / needs applicability review" })).not.toBeDisabled());
    await act(async () => { fireEvent.click(view.getByRole("checkbox", { name: "Unassigned / needs applicability review" })); });
    expect(view.getByRole("button", { name: "Save Default visible ships" })).toBeDisabled();
    await act(async () => { fireEvent.click(view.getByRole("checkbox", { name: "I confirm hiding Unassigned from app-wide defaults." })); });
    await act(async () => { fireEvent.click(view.getByRole("button", { name: "Save Default visible ships" })); });
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]).toEqual({ field: "defaultShips", values: ["unit:demo-meridian"], confirmHideUnassigned: true });
    await waitFor(() => expect(view.getByRole("checkbox", { name: "I confirm hiding Unassigned from app-wide defaults." })).not.toBeChecked());
  } finally { close(); }
});

test("user is read-only, missing citation arrays do not crash, and revoked writes retain the draft", async () => {
  const reader = setup("user", false, true);
  try {
    await waitFor(() => expect(reader.view.getByText(/Read only/)).toBeTruthy());
    expect(reader.view.getByRole("button", { name: "Save Display ship name" })).toBeDisabled();
    expect(reader.view.getByRole("button", { name: "Use FICTIONAL COPPER" })).toBeDisabled();
    expect(reader.view.getByText("Source unavailable")).toBeTruthy();
    expect(reader.requests).toHaveLength(0);
  } finally { reader.close(); }
  const admin = setup("platform_admin", true);
  try {
    await waitFor(() => expect(admin.view.getByLabelText("Display ship name")).not.toBeDisabled());
    await act(async () => { fireEvent.change(admin.view.getByLabelText("Display ship name"), { target: { value: "Fictional display override" } }); });
    await act(async () => { fireEvent.click(admin.view.getByRole("button", { name: "Save Display ship name" })); });
    await waitFor(() => expect(admin.view.getByRole("alert").textContent).toContain("Platform administrator"));
    expect(admin.view.getByLabelText("Display ship name")).toHaveValue("Fictional display override");
  } finally { admin.close(); }
});
