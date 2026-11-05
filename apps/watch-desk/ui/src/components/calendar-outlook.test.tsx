import { expect, spyOn, test } from "bun:test";
import { act, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderWithProviders } from "../test-utils/render";
import { CalendarOutlook } from "./calendar-outlook";
import type { Command } from "./command-roster";
import type { SourceRequest, TimelineItem } from "./source-data";

const commands: Command[] = [
  { id: "demo-tern", name: "USNS Tern", shortLabel: "TERN", group: "Fictional", colorIndex: 0, isOwnShip: true },
  { id: "demo-halyard", name: "USS Halyard", shortLabel: "HALYARD", group: "Fictional", colorIndex: 1, isOwnShip: false },
];
const messageKey = "fictional-outlook@r1";
const check: TimelineItem = { key: `${messageKey}#a1`, messageKey, factId: "a1", title: "communications check", kind: "point",
  at: "2026-11-05T08:00:00Z", commandIds: ["demo-tern"], reviewRequired: true };
function payload(limited = false) {
  return {
    messages: [{ sourceMessageId: messageKey, subject: "Fictional export tasking", events: [] }],
    meta: {
      windowLimited: limited,
      timelineItems: [check,
        { ...check, key: "a2", factId: "a2", title: "crypto changeover", at: "2026-11-06T20:00:00Z" },
        { ...check, key: "a3", factId: "a3", commandIds: ["demo-halyard"] },
      ],
      reviewItems: [{ ...check, key: "a4", factId: "a4", kind: "unresolved", at: undefined }],
    },
  };
}
function mount(selectedShips: Set<string> | undefined = new Set(["unit:demo-tern"])) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = renderWithProviders(<QueryClientProvider client={client}>
    <CalendarOutlook date="2026-11-05" selectedShips={selectedShips} commands={commands} dataset="canonical" returnTo="/calendar?date=2026-11-05" />
  </QueryClientProvider>);
  return { view, close: () => { view.unmount(); client.clear(); } };
}

test("panel prefills ships, filters types, downloads a calendar, and explains an unconfigured sync deployment", async () => {
  const requests: SourceRequest[] = [];
  const syncBodies: { ics: string }[] = [];
  const fetch = spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    if (String(url) === "/api/v1/calendar/outlook-sync") {
      syncBodies.push(JSON.parse(String(init?.body)));
      return Response.json({ code: "not_found" }, { status: 404 });
    }
    expect(String(url)).toBe("/api/v1/messages/timeline");
    requests.push(JSON.parse(String(init?.body)) as SourceRequest);
    return Response.json(payload());
  });
  const blobs: Blob[] = [];
  const urls = spyOn(URL, "createObjectURL").mockImplementation((blob) => { blobs.push(blob as Blob); return "blob:fictional-outlook"; });
  const revoke = spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const downloads: { filename: string; href: string }[] = [];
  const click = spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push({ filename: this.download, href: this.href });
  });
  const { view, close } = mount();
  try {
    expect(requests).toHaveLength(0);
    const trigger = view.getByRole("button", { name: "Sync to Outlook" });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = within(view.getByRole("dialog", { name: "Sync to Outlook" }));
    await waitFor(() => expect(dialog.getByText("2 events from 1 messages will sync")).toBeTruthy());
    expect(dialog.getByRole("checkbox", { name: "USNS Tern" })).toBeChecked();
    expect(dialog.getByRole("checkbox", { name: "USS Halyard" })).not.toBeChecked();
    expect(dialog.getByRole("checkbox", { name: "Unassigned / needs applicability review" })).not.toBeChecked();
    expect(dialog.getByLabelText("From (UTC)")).toHaveValue("2026-11-05");
    expect(dialog.getByLabelText("Through (UTC)")).toHaveValue("2026-11-12");
    expect(requests[0]).toEqual({ dataset: "canonical", from: "2026-11-05T00:00:00.000Z", to: "2026-11-13T00:00:00.000Z" });
    expect(dialog.getByText("1 without a time, not included")).toBeTruthy();
    expect(dialog.getByText("05 NOV 2026 0800Z").getAttribute("datetime")).toBe("2026-11-05T08:00:00.000Z");
    expect(dialog.getByText("06 NOV 2026 2000Z")).toBeTruthy();
    expect(dialog.queryByText("2026-11-05 08:00 UTC")).toBeNull();
    fireEvent.click(dialog.getByRole("checkbox", { name: "crypto changeover" }));
    expect(dialog.getByText("1 events from 1 messages will sync")).toBeTruthy();
    fireEvent.click(dialog.getByRole("button", { name: "Download .ics" }));
    expect(downloads).toEqual([{ filename: "otis-optasks-20261105.ics", href: "blob:fictional-outlook" }]);
    expect(blobs).toHaveLength(1);
    expect(blobs[0]).toBeInstanceOf(Blob);
    expect(blobs[0].type).toBe("text/calendar;charset=utf-8");
    const content = (await blobs[0].text()).replace(/\r\n /g, "");
    expect(content).toContain("BEGIN:VCALENDAR\r\n");
    expect(content).toContain("SUMMARY:communications check · USNS Tern");
    expect(content).not.toContain("crypto changeover");
    expect(content).not.toContain("USS Halyard");
    expect(content).toContain(`${window.location.origin}/messages?record=fictional-outlook%40r1`);
    expect(content).toContain("UNCLASSIFIED // FICTIONAL DEMO DATA");
    expect(content).not.toContain("Sent DTG:");
    expect(document.querySelector("a[download]")).toBeNull();
    await waitFor(() => expect(revoke).toHaveBeenCalledWith("blob:fictional-outlook"), { timeout: 2500 });
    fireEvent.click(dialog.getByRole("button", { name: "Sync to Outlook" }));
    await waitFor(() => expect(dialog.getByText("Direct sync is not configured on this deployment. Use Download .ics to import.")).toBeTruthy());
    expect(syncBodies).toHaveLength(1);
    expect(Object.keys(syncBodies[0])).toEqual(["ics"]);
    expect(syncBodies[0].ics.replace(/\r\n /g, "").replace(/DTSTAMP:[^\r]+/, "DTSTAMP:ignored"))
      .toBe(content.replace(/DTSTAMP:[^\r]+/, "DTSTAMP:ignored"));
    expect(requests).toHaveLength(1);
    fireEvent.click(dialog.getByRole("button", { name: "Clear", exact: true }));
    expect(dialog.getByText("0 events from 0 messages will sync")).toBeTruthy();
    expect(dialog.getByRole("button", { name: "Download .ics" })).toBeDisabled();
    fireEvent.click(dialog.getByRole("button", { name: "Select all" }));
    expect(dialog.getByText("2 events from 1 messages will sync")).toBeTruthy();
    expect(dialog.getByRole("checkbox", { name: "USS Halyard" })).toBeChecked();
    fireEvent.click(dialog.getByRole("button", { name: "Close sync to outlook" }));
    expect(view.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
    fireEvent.click(trigger);
    const reopened = within(view.getByRole("dialog"));
    expect(reopened.getByRole("checkbox", { name: "USS Halyard" })).not.toBeChecked();
    expect(reopened.getByRole("checkbox", { name: "crypto changeover" })).toBeChecked();
    expect(reopened.queryByText("Direct sync is not configured on this deployment. Use Download .ics to import.")).toBeNull();
  } finally { close(); click.mockRestore(); urls.mockRestore(); revoke.mockRestore(); fetch.mockRestore(); }
});

test("date edits read the new UTC window, invalid ranges block export, partial reads are explicit, and errors never export stale data", async () => {
  const requests: SourceRequest[] = [];
  let fail = false;
  const fetch = spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
    requests.push(JSON.parse(String(init?.body)) as SourceRequest);
    if (fail) return Response.json({ message: "Synthetic read failure" }, { status: 503 });
    return Response.json(payload(true));
  });
  const { view, close } = mount();
  try {
    fireEvent.click(view.getByRole("button", { name: "Sync to Outlook" }));
    const dialog = within(view.getByRole("dialog"));
    await waitFor(() => expect(dialog.getByText("2 events from 1 messages will sync")).toBeTruthy());
    expect(dialog.getByText(/Partial source results/)).toBeTruthy();
    fireEvent.change(dialog.getByLabelText("Through (UTC)"), { target: { value: "2026-11-05" } });
    await waitFor(() => expect(dialog.getByText("1 events from 1 messages will sync")).toBeTruthy());
    expect(requests[requests.length - 1].to).toBe("2026-11-06T00:00:00.000Z");
    const reads = requests.length;
    fireEvent.change(dialog.getByLabelText("Through (UTC)"), { target: { value: "2026-11-04" } });
    expect(dialog.getByRole("alert").textContent).toContain("Choose valid dates");
    expect(dialog.getByRole("button", { name: "Download .ics" })).toBeDisabled();
    expect(dialog.queryByRole("region", { name: "Export preview" })).toBeNull();
    expect(requests).toHaveLength(reads);
    fail = true;
    fireEvent.change(dialog.getByLabelText("Through (UTC)"), { target: { value: "2026-11-07" } });
    expect(dialog.getByRole("button", { name: "Download .ics" })).toBeDisabled();
    await waitFor(() => expect(dialog.getByRole("alert").textContent).toContain("Synthetic read failure"));
    expect(dialog.queryByRole("region", { name: "Export preview" })).toBeNull();
    expect(dialog.getByRole("button", { name: "Download .ics" })).toBeDisabled();
    fail = false;
    fireEvent.click(dialog.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(dialog.getByRole("button", { name: "Download .ics" })).not.toBeDisabled());
    await act(async () => { fireEvent(view.getByRole("dialog"), new Event("cancel", { cancelable: true })); });
    expect(view.queryByRole("dialog")).toBeNull();
  } finally { close(); fetch.mockRestore(); }
});

test("sync sends only the filtered ICS with same-origin credentials and reports created/updated counts", async () => {
  let finish: (response: Response) => void = () => {};
  const calls: RequestInit[] = [];
  const fetch = spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    if (String(url) === "/api/v1/calendar/outlook-sync") {
      calls.push(init!);
      return new Promise<Response>((resolve) => { finish = resolve; });
    }
    expect(String(url)).toBe("/api/v1/messages/timeline");
    return Response.json(payload());
  });
  const { view, close } = mount();
  try {
    fireEvent.click(view.getByRole("button", { name: "Sync to Outlook" }));
    const dialog = within(view.getByRole("dialog"));
    await waitFor(() => expect(dialog.getByText("2 events from 1 messages will sync")).toBeTruthy());
    fireEvent.click(dialog.getByRole("button", { name: "Sync to Outlook" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(dialog.getByRole("button", { name: "Syncing…" })).toBeDisabled();
    expect(dialog.getByRole("checkbox", { name: "USNS Tern" })).toBeDisabled();
    expect(calls[0]).toMatchObject({ method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" } });
    const body = JSON.parse(String(calls[0].body));
    expect(Object.keys(body)).toEqual(["ics"]);
    const ics = body.ics.replace(/\r\n /g, "");
    expect(ics).toContain("BEGIN:VCALENDAR\r\n");
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(ics).toContain("crypto changeover");
    expect(ics).not.toContain("USS Halyard");
    await act(async () => { finish(Response.json({ synced: 2, created: 1, updated: 1, calendar: "sailor · OTIS" })); });
    await waitFor(() => expect(dialog.getByText("Synced 2 events to the mailbox calendar (1 new, 1 updated)")).toBeTruthy());
    expect(dialog.getByRole("button", { name: "Sync to Outlook" })).not.toBeDisabled();
    expect(dialog.getByRole("checkbox", { name: "USNS Tern" })).not.toBeDisabled();
  } finally { close(); fetch.mockRestore(); }
});

test("sync errors and invalid replies show a Notice without claiming success, and allow retry", async () => {
  for (const failure of ["upstream", "network", "invalid"]) {
    const fetch = spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (String(url) === "/api/v1/messages/timeline") return Response.json(payload());
      expect(String(url)).toBe("/api/v1/calendar/outlook-sync");
      if (failure === "network") throw new Error("Synthetic network failure");
      if (failure === "invalid") return Response.json({ synced: 2, created: 9, updated: 0 });
      return Response.json({ code: "calendar_unavailable", message: "Mailbox calendar unavailable; retry safely." }, { status: 502 });
    });
    const { view, close } = mount();
    try {
      fireEvent.click(view.getByRole("button", { name: "Sync to Outlook" }));
      const dialog = within(view.getByRole("dialog"));
      await waitFor(() => expect(dialog.getByText("2 events from 1 messages will sync")).toBeTruthy());
      fireEvent.click(dialog.getByRole("button", { name: "Sync to Outlook" }));
      await waitFor(() => expect(dialog.getByRole("alert")).toBeTruthy());
      expect(dialog.queryByText(/^Synced /)).toBeNull();
      expect(dialog.getByRole("button", { name: "Sync to Outlook" })).not.toBeDisabled();
      expect(dialog.getByRole("button", { name: "Download .ics" })).not.toBeDisabled();
    } finally { close(); fetch.mockRestore(); }
  }
});

test("an explicitly empty sidebar stays empty and opening with all ships checks every ship", async () => {
  const fetch = spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(payload()));
  // Each mount gets a new QueryClient, including the all-ships case.
  for (const selected of [new Set<string>(), undefined]) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = renderWithProviders(<QueryClientProvider client={client}>
      <CalendarOutlook date="2026-11-05" selectedShips={selected} commands={commands} dataset="canonical" returnTo="/calendar" />
    </QueryClientProvider>);
    try {
      fireEvent.click(view.getByRole("button", { name: "Sync to Outlook" }));
      const dialog = within(view.getByRole("dialog"));
      await waitFor(() => expect(dialog.getByText(`${selected ? 0 : 3} events from ${selected ? 0 : 1} messages will sync`)).toBeTruthy());
      const input = dialog.getByRole("checkbox", { name: "USNS Tern" }) as HTMLInputElement;
      expect(input.checked).toBe(selected === undefined);
      if (selected) expect(dialog.getByRole("button", { name: "Download .ics" })).toBeDisabled();
    } finally { view.unmount(); client.clear(); }
  }
  fetch.mockRestore();
});
