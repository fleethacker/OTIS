import { expect, spyOn, test } from "bun:test";
import { act, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useLocation } from "react-router-dom";
import { create } from "@bufbuild/protobuf";
import { MessageRecordSchema } from "../gen/app/v1/models_pb";
import { renderWithProviders } from "../test-utils/render";
import { WatchSessionContext, useWatchSession, type WatchSession } from "./watch-session";
import { AuthGate } from "./AuthGate";
import { WatchTurnoverPanel } from "./watch-turnover-panel";
import { DayTimeline } from "./day-timeline";
import { watchPanelHref } from "./watch-calendar-link";
import type { WatchChange } from "./watch-changes";

const now = Date.parse("2026-11-05T10:00:00Z");
const since = "2026-11-05T08:12:00Z";
const key = `sha256:${"a".repeat(64)}@fictional-r1`;
const base: WatchChange = { id: "fictional-a", messageKey: key, receiptId: "receipt-a", sequence: 1,
  title: "Fictional tasking", sender: "FICTIONAL COMMAND", commandIds: ["demo-meridian"], issuedAt: "2026-11-05T08:30:00Z",
  recordedAt: "2026-11-05T09:00:00Z", basis: "source_issue_time", reviewedAt: null,
  addedEvents: [{ factId: "a1", title: "crypto changeover", at: "2026-11-05T13:30:00Z", commandIds: ["demo-meridian"], recurrence: { rule: "FREQ=DAILY" } }] };
const unassigned: WatchChange = { ...base, id: "fictional-b", title: "Fictional unassigned", messageKey: `sha256:${"b".repeat(64)}@fictional-r1`, commandIds: [], addedEvents: [] };
const unknown: WatchChange = { ...base, id: "fictional-c", title: "Fictional undated", messageKey: `sha256:${"c".repeat(64)}@fictional-r1`, issuedAt: null, basis: "issue_time_unavailable", addedEvents: [] };
const session: WatchSession = { scope: "fictional-person", since, basis: "last_seen" };
function Location() { return <output data-testid="location">{useLocation().search}</output>; }
function page(rows: WatchChange[], request: Record<string, unknown>) {
  return { items: rows.filter((r) => r.issuedAt), unknownTime: rows.filter((r) => !r.issuedAt), unknownHiddenCount: 0, unknownLimited: false,
    returnedNewCount: rows.filter((r) => r.issuedAt).length, hiddenCount: 0, hiddenShipIds: [], nextBefore: null,
    watermark: "shown-window-one", since: request.since ?? since, until: request.until,
    availability: { newRecords: "available", amended: "not_available", cancelled: "not_available", reviewTransitions: "not_available" }, scope: "Returned messages only." };
}

test("authenticated session passes additive pinned boundary metadata to catch-up", async () => {
  const fetch = spyOn(globalThis, "fetch").mockImplementation(async (url) => {
    expect(String(url)).toBe("/auth/session");
    return Response.json({ scope: "a".repeat(64), expiresAt: null, sessionExpiresAt: null, mode: "local_demo", since, basis: "last_seen" });
  });
  function Probe() { const value = useWatchSession(); return <p>{value?.since} · {value?.basis}</p>; }
  const view = renderWithProviders(<AuthGate><Probe /></AuthGate>);
  try { await waitFor(() => expect(view.getByText(`${since} · last_seen`)).toBeTruthy()); }
  finally { view.unmount(); fetch.mockRestore(); }
});

test("pinned session groups additions, navigates to the event date, and records caller-scoped review", async () => {
  let rows = [base, unassigned, unknown];
  let deny = false;
  const requests: { path: string; body: Record<string, unknown> }[] = [];
  const fetch = spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    const path = String(url), body = JSON.parse(String(init?.body));
    requests.push({ path, body });
    if (path.endsWith("/list")) return Response.json(page(rows, body));
    if (deny) return Response.json({ message: "Review unavailable" }, { status: 503 });
    const keys = path.endsWith("/review-all") ? rows.map((r) => r.messageKey) : body.messageKeys as string[];
    rows = rows.map((row) => row.messageKey !== null && keys.includes(row.messageKey) ? { ...row, reviewedAt: "2026-11-05T10:00:00Z" } : row);
    return Response.json({ reviewedAt: "2026-11-05T10:00:00Z" });
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = renderWithProviders(<QueryClientProvider client={client}><WatchSessionContext.Provider value={session}>
    <WatchTurnoverPanel turnovers={["0000Z", "0800Z"]} now={now} returnTo="/calendar?date=2026-11-04&q=old" /><Location />
  </WatchSessionContext.Provider></QueryClientProvider>, { route: "/calendar?date=2026-11-04&q=old" });
  try {
    await waitFor(() => expect(view.getByRole("link", { name: "Fictional tasking" })).toBeTruthy());
    expect(view.getByText("Since you were last here · 05 NOV 2026 0812Z")).toBeTruthy();
    expect(view.container.querySelector("details")!.open).toBe(true);
    expect(view.getByText(/1 new · 2 need review · 0 of 3 reviewed/)).toBeTruthy();
    expect(within(view.getByRole("region", { name: "New tasking" })).getByRole("link", { name: "Fictional tasking" })).toBeTruthy();
    expect(view.getByRole("region", { name: "New tasking" }).textContent).toContain("1330Z crypto changeover · daily");
    expect(view.getByRole("region", { name: "Catch-up needs review" }).textContent).toContain("Fictional unassigned");
    expect(view.getByRole("region", { name: "No sent time in source" })).toBeTruthy();
    expect(requests[0].body.since).toBeUndefined();
    const calendar = view.getByRole("link", { name: "Show on calendar: Fictional tasking" });
    await act(async () => { fireEvent.click(calendar); });
    await waitFor(() => expect(view.getByTestId("location").textContent).toContain("date=2026-11-05"));
    const params = new URLSearchParams(view.getByTestId("location").textContent!);
    expect(params.get("view")).toBe("day"); expect(params.get("q")).toBeNull(); expect(params.get("focusMessage")).toBe(key);
    await act(async () => { fireEvent.click(view.getByRole("checkbox", { name: "Reviewed: Fictional tasking" })); });
    await waitFor(() => expect(view.getByText(/1 of 3 reviewed/)).toBeTruthy());
    const single = requests.find((r) => r.path.endsWith("/review"));
    expect(single?.body).toEqual({ messageKeys: [key] });
    expect(view.getByRole("checkbox", { name: "Reviewed: Fictional tasking" })).toBeChecked();
    expect(view.queryByText(/crypto changeover/)).toBeNull();
    deny = true;
    await act(async () => { fireEvent.click(view.getByRole("checkbox", { name: "Reviewed: Fictional unassigned" })); });
    await waitFor(() => expect(view.getByRole("alert").textContent).toContain("Review unavailable"));
    expect(view.getByRole("checkbox", { name: "Reviewed: Fictional unassigned" })).not.toBeChecked();
    deny = false;
    await act(async () => { fireEvent.click(view.getByRole("button", { name: "Mark all reviewed" })); });
    await waitFor(() => expect(view.getByText(/3 of 3 reviewed/)).toBeTruthy());
    expect(requests.find((r) => r.path.endsWith("/review-all"))?.body).toEqual({ watermark: "shown-window-one" });
    expect(view.container.querySelector("details")!.open).toBe(false);
  } finally { view.unmount(); client.clear(); fetch.mockRestore(); }
});

test("session fallback basis is explicit and UTC picker remains an alternative", async () => {
  for (const basis of ["turnover", "default_24h"] as const) {
    const requests: Record<string, unknown>[] = [];
    const fetch = spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body)); requests.push(body); return Response.json(page([base], body));
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = renderWithProviders(<QueryClientProvider client={client}><WatchSessionContext.Provider value={{ ...session, since: "2026-11-05T08:00:00Z", basis }}>
      <WatchTurnoverPanel turnovers={["0000Z", "0800Z"]} now={now} returnTo="/calendar" />
    </WatchSessionContext.Provider></QueryClientProvider>, { route: "/calendar" });
    try {
      await waitFor(() => expect(view.getByText(basis === "turnover" ? "Since 0800Z turnover" : "Last 24 hours")).toBeTruthy());
      await waitFor(() => expect(view.getByRole("button", { name: "Apply UTC" })).toBeTruthy());
      await act(async () => { fireEvent.change(view.getByLabelText("Since (UTC)"), { target: { value: "05 NOV 2026 0900Z" } }); });
      await act(async () => { fireEvent.click(view.getByRole("button", { name: "Apply UTC" })); });
      await waitFor(() => expect(requests.some((r) => r.since === "2026-11-05T09:00:00.000Z")).toBe(true));
    } finally { view.unmount(); client.clear(); fetch.mockRestore(); }
  }
});

test("calendar marks new messages in every view without changing title controls; explicit links highlight", async () => {
  for (const mode of ["day", "week", "month"] as const) {
    const from = Date.parse(mode === "day" ? "2026-11-05T00:00:00Z" : "2026-11-01T00:00:00Z");
    const to = Date.parse(mode === "month" ? "2026-12-01T00:00:00Z" : mode === "week" ? "2026-11-08T00:00:00Z" : "2026-11-06T00:00:00Z");
    const props = { messages: [create(MessageRecordSchema, { sourceMessageId: key })], sourceItems: [{ key: `${key}#a1`, messageKey: key, factId: "a1", title: "Fictional check", kind: "point" as const, at: "2026-11-05T13:30:00Z", reviewRequired: true }],
      from, to, view: mode, interval: 60, returnTo: `/calendar?${new URLSearchParams({ focusMessage: key, focusAt: "2026-11-05T13:30:00Z", focusFact: "a1" })}` };
    const view = renderWithProviders(<DayTimeline {...props} newMessageKeys={new Set([key])} />);
    try {
      expect(view.container.querySelector(".calendar-new-marker")?.textContent).toBe("new");
      const control = view.getByRole(mode === "week" ? "button" : "link", { name: `Fictional check, ${mode === "week" ? "event details" : "source record"}` });
      expect(control.textContent).toBe("Fictional check");
      await waitFor(() => expect(control.closest(".rbc-event")).toHaveClass("calendar-catchup-focus"));
      view.rerender(<DayTimeline {...props} newMessageKeys={new Set()} />);
      expect(view.container.querySelector(".calendar-new-marker")).toBeNull();
    } finally { view.unmount(); }
  }
  const bell = new URL(watchPanelHref("/calendar?date=2026-11-05&since=closed:auto"), "http://localhost");
  expect(bell.hash).toBe("#since-last-watch"); expect(bell.searchParams.get("since")).toBe("auto");
});
