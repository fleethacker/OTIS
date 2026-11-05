import "../route-registry";
import { expect, spyOn, test } from "bun:test";
import { waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderWithProviders } from "../test-utils/render";
import Calendar from "../pages/calendar";
import { messageSearchState } from "./message-search-state";

test("Calendar keeps one hybrid search request and reports the executed mode as non-live text", async () => {
  for (const executedMode of ["hybrid", "keyword", undefined]) {
    const requests: { operation: string; body: Record<string, unknown> }[] = [];
    const fetch = spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const operation = String(url).split("/").pop()!;
      requests.push({ operation, body: JSON.parse(String(init?.body)) });
      if (operation === "list") return Response.json({ commands: [], source: "fictional", version: "test", provenance: "fictional", assignmentEnabled: false });
      if (operation !== "timeline") throw new Error("Calendar must not introduce a second search request");
      return Response.json({ messages: [], meta: { executedMode, timelineItems: [], reviewItems: [] } });
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = renderWithProviders(<QueryClientProvider client={client}><Calendar /></QueryClientProvider>, { route: "/calendar?date=2026-11-05&q=communications" });
    try {
      await waitFor(() => expect(view.getByText(new RegExp(`Executed search: ${executedMode ?? "not reported by server"}`))).toBeTruthy());
      const mode = view.getByText(/Executed search:/);
      expect(mode.closest('[role="status"], [aria-live]')).toBeNull();
      const outlook = view.getByRole("button", { name: "Sync to Outlook" });
      expect(outlook.closest(".timeline-toolbar")).not.toBeNull();
      expect(outlook.closest(".calendar-controls")).toBeNull();
      expect(view.getByLabelText("UTC date").closest(".calendar-controls")).not.toBeNull();
      expect(view.queryByRole("combobox", { name: "Search mode" })).toBeNull();
      expect(view.queryByRole("link", { name: /Find related/ })).toBeNull();
      expect(requests.find((r) => r.operation === "timeline")?.body).toMatchObject({ query: "communications", mode: "hybrid" });
      expect(requests.some((r) => r.operation === "search")).toBe(false);
    } finally { view.unmount(); client.clear(); fetch.mockRestore(); }
  }
  expect(messageSearchState(new URLSearchParams("mode=keyword"), "radio rehearsal").request.mode).toBe("hybrid");
});
