import { expect, spyOn, test } from "bun:test";
import { act, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useLocation } from "react-router-dom";
import { renderWithProviders } from "../test-utils/render";
import {
  formatSinceUTC,
  isoBoundary,
  latestTurnover,
  parseSinceUTC,
  sinceState,
} from "./watch-boundary";
import { WatchTurnoverPanel } from "./watch-turnover-panel";
import type { ChangeRequest, WatchChange } from "./watch-changes";

const now = Date.parse("2026-11-05T10:00:00Z");
const times = ["0000Z", "0400Z", "0800Z", "1200Z", "1600Z", "2000Z"];
test("UTC input validates real dates, preserves precision and selects inclusive automatic boundaries", () => {
  for (const value of ["2026-11-05T04:00:00.000Z", "2026-11-05T16:23:42.123Z"]) {
    expect(parseSinceUTC(formatSinceUTC(Date.parse(value)))).toBe(Date.parse(value));
  }
  for (const value of [
    "31 NOV 2026 1600Z",
    "05 NOV 2026 2400Z",
    "05 NOV 2026 1260Z",
    "29 FEB 2025 1200Z",
  ])
    expect(parseSinceUTC(value)).toBeUndefined();
  expect(isoBoundary("2026-02-30T00:00:00Z")).toBeUndefined();
  expect(isoBoundary("2026-11-05T04:00:00-05:00")).toBeUndefined();
  const boundary = Date.parse("2026-11-05T04:00:00Z");
  expect(latestTurnover(boundary, times)).toBe(boundary);
  expect(latestTurnover(Date.parse("2026-11-05T02:00:00Z"), ["0400Z", "2000Z"])).toBe(
    Date.parse("2026-11-04T20:00:00Z")
  );
  expect(latestTurnover(now)).toBeUndefined();
  expect(sinceState(null, now, times).open).toBe(false);
  expect(sinceState("closed:2026-11-05T04:00:00Z", now, times).boundary).toBe(boundary);
  expect(sinceState("broken", now, times).invalid).toBe(true);
});
function Location() {
  return <output data-testid="location">{useLocation().search}</output>;
}
test("unavailable custody is not displayed as zero changes", async () => {
  const fetch = spyOn(globalThis, "fetch").mockImplementation(async () =>
    Response.json({ code: "unavailable", message: "Custody unavailable" }, { status: 503 })
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = renderWithProviders(
    <QueryClientProvider client={client}>
      <WatchTurnoverPanel turnovers={times} now={now} returnTo="/calendar?since=auto" />
    </QueryClientProvider>,
    { route: "/calendar?since=auto" }
  );
  try {
    await waitFor(() =>
      expect(view.getByRole("alert").textContent).toContain("Custody unavailable")
    );
    await waitFor(() => expect(client.isFetching()).toBe(0));
    expect(view.queryByText(/0 messages sent/)).toBeNull();
  } finally {
    view.unmount();
    client.clear();
    fetch.mockRestore();
  }
});
test("turnover uses exact custody sources, keeps unknowns outside counts and validates UTC before changing URL", async () => {
  const base: WatchChange = {
    id: "fictional-tern",
    messageKey: `sha256:${"a".repeat(64)}@fictional-r1`,
    receiptId: "receipt-one",
    sequence: 1,
    title: "Fictional Tern receipt",
    commandIds: ["demo-tern"],
    issuedAt: "2026-11-05T04:00:00Z",
    recordedAt: "2026-11-05T09:00:00Z",
    basis: "source_issue_time",
  };
  const dated = [
    base,
    {
      ...base,
      id: "fictional-halyard",
      messageKey: `sha256:${"b".repeat(64)}@fictional-r1`,
      title: "Fictional Halyard receipt",
      commandIds: ["demo-halyard"],
      issuedAt: "2026-11-05T06:00:00Z",
    },
  ];
  const unknown = {
    ...base,
    id: "fictional-unknown",
    messageKey: null,
    title: "Fictional undated receipt",
    issuedAt: null,
    basis: "issue_time_unavailable",
  };
  const requests: ChangeRequest[] = [];
  const fetch = spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    if (!String(url).endsWith("/changes/list")) throw new Error("Unexpected request");
    const request: ChangeRequest = JSON.parse(String(init?.body));
    requests.push(request);
    const inWindow = dated.filter(
      (r) =>
        Date.parse(r.issuedAt!) >= Date.parse(request.since) &&
        Date.parse(r.issuedAt!) < Date.parse(request.until)
    );
    const visible = (ids: string[]) =>
      !request.filters.noCommands &&
      ((!request.filters.commandIds?.length && !request.filters.unassignedOnly) ||
        ids.some((id) => request.filters.commandIds?.includes(id)) ||
        (!ids.length && request.filters.unassignedOnly));
    return Response.json({
      items: inWindow.filter((r) => visible(r.commandIds)),
      unknownTime: visible(unknown.commandIds) ? [unknown] : [],
      unknownHiddenCount: visible(unknown.commandIds) ? 0 : 1,
      unknownLimited: false,
      returnedNewCount: inWindow.length,
      hiddenCount: inWindow.filter((r) => !visible(r.commandIds)).length,
      hiddenShipIds: ["unit:demo-halyard"],
      nextBefore: null,
      watermark: 2,
      since: request.since,
      until: request.until,
      availability: {
        newRecords: "available",
        amended: "not_available",
        cancelled: "not_available",
        reviewTransitions: "not_available",
      },
      scope: "Counts cover returned pages only.",
    });
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const route =
    "/calendar?date=2026-11-05&since=2026-11-05T04%3A00%3A00Z&ships=%5B%22unit%3Ademo-tern%22%5D";
  const view = renderWithProviders(
    <QueryClientProvider client={client}>
      <WatchTurnoverPanel turnovers={times} now={now} returnTo={route} />
      <Location />
    </QueryClientProvider>,
    { route }
  );
  try {
    await waitFor(() => expect(view.getByRole("link", { name: base.title })).toBeTruthy());
    expect(view.getByText(/Amended: not available/)).toBeTruthy();
    expect(view.getByText(/2 messages sent/)).toBeTruthy();
    expect(view.getByText(/Fictional undated receipt · source unavailable/)).toBeTruthy();
    const source = new URL(
      view.getByRole("link", { name: base.title }).getAttribute("href")!,
      "http://localhost"
    );
    expect(source.searchParams.get("record")).toBe(base.messageKey);
    expect(source.searchParams.get("tab")).toBe("lifecycle");
    expect(source.searchParams.get("returnTo")).toBe(route);
    const original = view.getByTestId("location").textContent;
    await act(async () => {
      fireEvent.change(view.getByLabelText("Since (UTC)"), {
        target: { value: "31 NOV 2026 1600Z" },
      });
    });
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Apply UTC" }));
    });
    expect(view.getByRole("alert").textContent).toContain("valid UTC");
    expect(view.getByTestId("location").textContent).toBe(original);
    await act(async () => {
      fireEvent.change(view.getByLabelText("Since (UTC)"), {
        target: { value: "05 NOV 2026 0500Z" },
      });
    });
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Apply UTC" }));
    });
    await waitFor(() =>
      expect(requests.some((r) => r.since === "2026-11-05T05:00:00.000Z")).toBe(true)
    );
    await waitFor(() => expect(client.isFetching()).toBe(0));
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Show all ships" }));
    });
    await waitFor(() =>
      expect(view.getByRole("link", { name: "Fictional Halyard receipt" })).toBeTruthy()
    );
    expect(new URLSearchParams(view.getByTestId("location").textContent!).has("ships")).toBe(false);
  } finally {
    view.unmount();
    client.clear();
    fetch.mockRestore();
  }
});
