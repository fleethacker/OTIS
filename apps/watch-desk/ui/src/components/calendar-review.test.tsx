import "../route-registry";
import { expect, spyOn, test } from "bun:test";
import { act, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { create } from "@bufbuild/protobuf";
import { MessageRecordSchema } from "../gen/app/v1/models_pb";
import { renderWithProviders, testSession } from "../test-utils/render";
import Calendar from "../pages/calendar";
import { CalendarReview } from "./calendar-review";
import { sourceScopeKey, type TimelineItem } from "./source-data";

const key = `sha256:${"a".repeat(64)}@fictional-r1`;
const review: TimelineItem = {
  key: `${key}#fictional-unresolved`,
  messageKey: key,
  factId: "fictional-unresolved",
  title: "Fictional Meridian inspection",
  kind: "unresolved",
  reason: "Date is not provided by this fictional source.",
  reviewRequired: true,
};
const returnTo = "/calendar?date=2026-11-05&view=week&ships=%5B%22unassigned%3A%22%5D";

test("review cites the exact revision, preserves calendar state and discloses bounds", () => {
  let shown = false;
  const view = renderWithProviders(
    <CalendarReview
      items={[review]}
      limited
      filtered
      returnTo={returnTo}
      onShowAll={() => {
        shown = true;
      }}
    />
  );
  const source = view.getByRole("link", { name: review.title });
  const href = new URL(source.getAttribute("href")!, "http://localhost");
  expect(href.searchParams.get("record")).toBe(key);
  expect(href.searchParams.get("returnTo")).toBe(returnTo);
  expect(view.getByText(/Fact fictional-unresolved/)).toBeTruthy();
  expect(view.getByText(/review results are incomplete/)).toBeTruthy();
  expect(view.getByText(/Hidden review counts are unavailable/)).toBeTruthy();
  fireEvent.click(view.getByRole("button", { name: "Show all ships and clear search" }));
  expect(shown).toBe(true);
});

test("missing evidence has no borrowed link; empty and unavailable are distinct", () => {
  const missing = renderWithProviders(
    <CalendarReview
      items={[{ ...review, messageKey: "" }]}
      limited={false}
      filtered={false}
      returnTo={returnTo}
      onShowAll={() => {}}
    />
  );
  expect(missing.queryByRole("link")).toBeNull();
  expect(missing.getByText("Source unavailable")).toBeTruthy();
  missing.unmount();
  const empty = renderWithProviders(
    <CalendarReview
      items={[]}
      limited={false}
      filtered={false}
      returnTo={returnTo}
      onShowAll={() => {}}
    />
  );
  expect(empty.getByText("No unresolved times in the returned records.")).toBeTruthy();
  empty.unmount();
  const unknown = renderWithProviders(
    <CalendarReview limited={false} filtered={false} returnTo={returnTo} onShowAll={() => {}} />
  );
  expect(unknown.getByText("Review data unavailable.")).toBeTruthy();
  expect(unknown.queryByText(/No unresolved times/)).toBeNull();
});

test("unqueried selection and filtered empty review never imply an all-clear", () => {
  const view = renderWithProviders(
    <CalendarReview
      items={[]}
      notQueried
      limited={false}
      filtered
      returnTo={returnTo}
      onShowAll={() => {}}
    />
  );
  expect(view.getByText(/Needs review · not queried/)).toBeTruthy();
  expect(view.getByText("No ships selected; review was not queried.")).toBeTruthy();
  expect(view.queryByText(/No unresolved times/)).toBeNull();
  view.unmount();
  const filtered = renderWithProviders(
    <CalendarReview items={[]} limited={false} filtered returnTo={returnTo} onShowAll={() => {}} />
  );
  expect(filtered.getByText(/No review items match the current filters/)).toBeTruthy();
  expect(filtered.queryByText(/No unresolved times/)).toBeNull();
});

test("Calendar consumes reviewItems separately from points and hides stale review on failed refresh", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const request = {
    dataset: "canonical",
    query: "",
    mode: "hybrid",
    from: "2026-11-05T00:00:00.000Z",
    to: "2026-11-06T00:00:00.000Z",
    filters: {},
  };
  client.setQueryData(
    [
      "parse-command-source",
      "timeline",
      request,
      testSession.user!.id,
      sourceScopeKey(testSession),
    ],
    {
      messages: [create(MessageRecordSchema, { sourceMessageId: key })],
      meta: {
        reviewItems: [review],
        windowLimited: true,
        timelineItems: [
          {
            ...review,
            key: `${key}#point`,
            factId: "point",
            title: "Fictional point",
            kind: "point",
            at: "2026-11-05T08:00:00Z",
          },
        ],
      },
    }
  );
  client.setQueryData(["watchdesk-commands", testSession.user!.id, sourceScopeKey(testSession)], {
    commands: [],
    source: "fictional config",
    version: "test",
    provenance: "fictional",
    assignmentEnabled: false,
  });
  const fetch = spyOn(globalThis, "fetch").mockImplementation(
    async () =>
      new Response(JSON.stringify({ message: "Fictional source unavailable" }), { status: 503 })
  );
  const view = renderWithProviders(
    <QueryClientProvider client={client}>
      <Calendar />
    </QueryClientProvider>,
    { route: "/calendar?date=2026-11-05" }
  );
  try {
    expect(view.getByRole("region", { name: "Needs review" }).textContent).toContain(review.title);
    expect(view.getByRole("link", { name: "Fictional point, source record" })).toBeTruthy();
    expect(view.getByText(/Partial source results/)).toBeTruthy();
    await act(async () => {
      await client.invalidateQueries({ queryKey: ["parse-command-source"] });
    });
    expect(fetch).toHaveBeenCalled();
    await waitFor(() =>
      expect(view.getByText(/Showing the last successful schedule/).textContent).toContain(
        "Fictional source unavailable"
      )
    );
    expect(view.queryByRole("region", { name: "Needs review" })).toBeNull();
    expect(view.getByRole("link", { name: "Fictional point, source record" })).toBeTruthy();
  } finally {
    view.unmount();
    client.clear();
    fetch.mockRestore();
  }
});
