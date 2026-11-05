import "../route-registry";
import { expect, spyOn, test } from "bun:test";
import { act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { renderWithProviders } from "../test-utils/render";
import { ExtractedEventSchema, MessageRecordSchema } from "../gen/app/v1/models_pb";
import { DayTimeline } from "../components/day-timeline";
import {
  geometry,
  HOUR,
  utcDate,
  monthBounds,
  moveMonth,
  weekBounds,
} from "../components/calendar-time";
import Calendar from "./calendar";
import type { TimelineItem } from "../components/source-data";
import { discover } from "../components/schedule-discovery";
import {
  readShips,
  shipOptions,
  shipKey,
  shipColor,
  UNASSIGNED,
} from "../components/ship-calendars";

test("ship identity, explicit none, stale keys and shared-message review never broaden selection", () => {
  const a = { ...event, unit: " Fictional A ", title: "Alpha" };
  const b = {
    ...event,
    id: 2n,
    unit: "Fictional B",
    title: "Bravo",
    scheduleStatus: "needs_review",
  };
  const message = create(MessageRecordSchema, {
    id: 1n,
    rawText: "shared",
    processingStatus: "needs_review",
    events: [a, b],
  });
  const empty = create(MessageRecordSchema, {
    id: 2n,
    rawText: "shared",
    processingStatus: "needs_review",
  });
  const source = [message, empty];
  expect(shipOptions(source).map(([key]) => key)).toEqual([
    UNASSIGNED,
    shipKey(a.unit),
    shipKey(b.unit),
  ]);
  const selected = discover(source, "shared", midnight, new Set([shipKey(a.unit)]));
  expect(selected.timed.map(({ event }) => event.title)).toEqual(["Alpha"]);
  expect(selected.review).toHaveLength(0);
  expect(selected.upcoming).toHaveLength(1);
  expect(discover(source, "Bravo", midnight, new Set([shipKey(a.unit)])).messages).toHaveLength(0);
  expect(
    discover(source, "shared", midnight, new Set([UNASSIGNED])).review.map((m) => m.id)
  ).toEqual([2n]);
  expect(discover(source, "", midnight, readShips("[]")).messages).toHaveLength(0);
  expect(discover(source, "", midnight, readShips('["stale"]')).messages).toHaveLength(0);
  expect(discover(source, "", midnight, readShips("invalid")).messages).toHaveLength(0);
  expect(readShips(null)).toBeUndefined();
  expect(shipKey(" A ")).toBe(shipKey("A"));
  expect(shipKey("a")).not.toBe(shipKey("A"));
  expect(shipColor(shipKey(a.unit))).toBe(shipColor(shipKey("Fictional A")));
  expect(message.events).toHaveLength(2);
});

const midnight = Date.parse("2026-11-04T00:00:00Z");
const event = create(ExtractedEventSchema, {
  id: 1n,
  title: "Short event",
  scheduleStatus: "confirmed",
  startAt: timestampFromDate(new Date(midnight + 8.25 * HOUR)),
  endAt: timestampFromDate(new Date(midnight + 8.5 * HOUR)),
});
test("actual UTC month lengths, exact fractions and keyboard day controls", () => {
  for (const [date, days] of [
    ["2025-02-01", 28],
    ["2024-02-01", 29],
    ["2026-11-01", 30],
    ["2026-12-01", 31],
  ] as const) {
    const bounds = monthBounds(date);
    expect(bounds.days).toBe(days);
    const short = {
      ...event,
      startAt: timestampFromDate(new Date(bounds.from + 8.25 * HOUR)),
      endAt: timestampFromDate(new Date(bounds.from + 8.5 * HOUR)),
    };
    expect(geometry(short, bounds.from, bounds.to)?.width).toBeCloseTo(
      (100 * 0.25) / (days * 24),
      8
    );
    const message = create(MessageRecordSchema, { sourceMessageId: "SOURCE-1", events: [short] });
    const view = renderWithProviders(
      <DayTimeline
        messages={[message]}
        {...bounds}
        interval={60}
        view="month"
        returnTo="/calendar?view=month"
      />
    );
    for (let day = 1; day <= days; day++) {
      expect(
        view.getByRole("button", {
          name: `Open ${date.slice(0, 7)}-${String(day).padStart(2, "0")} in Day view`,
        })
      ).toBeTruthy();
    }
    view.unmount();
  }
  expect(moveMonth("2026-12-31", 1)).toBe("2027-01-01");
  expect(moveMonth("2026-03-31", -1)).toBe("2026-02-01");
});
async function withCalendar(route: string, assertions: (view: ReturnType<typeof renderWithProviders>) => void) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const fetch = spyOn(globalThis, "fetch").mockImplementation(async (url) => Response.json(
    String(url).endsWith("/commands/list")
      ? { commands: [], source: "fictional config", version: "test", provenance: "fictional", assignmentEnabled: false }
      : { messages: [], meta: { reviewItems: [], timelineItems: [] } }
  ));
  const view = renderWithProviders(<QueryClientProvider client={client}><Calendar /></QueryClientProvider>, { route });
  try {
    assertions(view);
    await waitFor(() => {
      const timeline = client.getQueryCache().find({ queryKey: ["parse-command-source", "timeline"], exact: false });
      expect(timeline?.state.status).toBe("success");
      expect(timeline?.state.fetchStatus).toBe("idle");
      // Compare a scalar: serializing Happy DOM nodes on each retry blocks its task queue.
      expect(view.queryByText("Loading schedule…") === null).toBe(true);
    });
    expect(view.queryByRole("region", { name: "Needs review" })).toBeNull();
  } finally { view.unmount(); client.clear(); fetch.mockRestore(); }
}
test("calendar omits review disclosure while retaining timed events and failure handling", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const key = `sha256:${"a".repeat(64)}@fictional-r1`;
  const review: TimelineItem = {
    key: `${key}#unresolved`, messageKey: key, factId: "unresolved", kind: "unresolved",
    title: "Fictional undated inspection", reason: "No source date", reviewRequired: true,
  };
  const request = {
    dataset: "canonical", query: "", mode: "hybrid",
    from: "2026-11-05T00:00:00.000Z", to: "2026-11-06T00:00:00.000Z", filters: {},
  };
  client.setQueryData(["parse-command-source", "timeline", request], {
    messages: [create(MessageRecordSchema, { sourceMessageId: key })],
    meta: {
      reviewItems: [review], windowLimited: true,
      timelineItems: [{ ...review, key: `${key}#point`, factId: "point", title: "Fictional point", kind: "point", at: "2026-11-05T08:00:00Z" }],
    },
  });
  client.setQueryData(["watchdesk-commands"], { commands: [], source: "fictional config", version: "test", provenance: "fictional", assignmentEnabled: false });
  const fetch = spyOn(globalThis, "fetch").mockImplementation(async () =>
    Response.json({ message: "Fictional source unavailable" }, { status: 503 })
  );
  const view = renderWithProviders(<QueryClientProvider client={client}><Calendar /></QueryClientProvider>, {
    route: "/calendar?date=2026-11-05",
  });
  try {
    expect(view.queryByRole("region", { name: "Needs review" })).toBeNull();
    expect(view.queryByText(review.title)).toBeNull();
    expect(view.getByRole("link", { name: "Fictional point, source record" })).toBeTruthy();
    expect(view.getByText(/Partial source results/)).toBeTruthy();
    await act(async () => { await client.invalidateQueries({ queryKey: ["parse-command-source"] }); });
    await waitFor(() => expect(view.getByText(/Calendar could not be loaded/).textContent).toContain("Fictional source unavailable"));
    expect(view.queryByRole("region", { name: "Needs review" })).toBeNull();
    expect(view.queryByRole("link", { name: "Fictional point, source record" })).toBeNull();
  } finally { view.unmount(); client.clear(); fetch.mockRestore(); }
});

test("calendar mounts controls and truthful loading", async () => {
  await withCalendar("/calendar?date=2026-11-04&interval=30&hours=6-12&q=watch", (view) => {
  expect(view.getByLabelText("UTC date")).toHaveValue("2026-11-04");
  expect(view.queryByLabelText("Grid interval")).toBeNull();
  expect(view.getByRole("searchbox", { name: "Search schedule" })).toHaveValue("watch");
  const search = view.getByRole("searchbox", { name: "Search schedule" });
  expect(search.closest("section")?.getAttribute("aria-label")).toBe("Calendar controls");
  expect(search).not.toHaveAttribute("aria-describedby");
  expect(view.queryByText(/Ship schedule/)).toBeNull();
  expect(view.queryByText(/Hybrid keyword/)).toBeNull();
  expect(view.container.querySelector(".view-label")).toBeNull();
  expect(view.getByText("Loading schedule…").getAttribute("role")).toBe("status");
  });
});
test("week is an accessible URL-owned view with civil DST/year boundaries", async () => {
  await withCalendar("/calendar?view=week&date=2026-11-04&interval=30&hours=6-12&q=watch", (view) => {
  expect(view.getByRole("button", { name: "Week", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  expect(view.getByRole("button", { name: "Previous week" })).toBeTruthy();
  expect(view.queryByLabelText("Grid interval")).toBeNull();
  expect(view.queryByLabelText("Visible hours (UTC)")).toBeNull();
  expect(
    (weekBounds("2026-11-04", "America/New_York").to -
      weekBounds("2026-11-04", "America/New_York").from) /
      HOUR
  ).toBe(169);
  expect(
    (weekBounds("2026-03-11", "America/New_York").to -
      weekBounds("2026-03-11", "America/New_York").from) /
      HOUR
  ).toBe(167);
  expect(new Date(weekBounds("2027-01-01").from).toISOString()).toBe("2026-12-27T00:00:00.000Z");
  });
});
test("weekly daily windows include the last day and exclude unresolved events", () => {
  const bounds = weekBounds("2026-11-04");
  const last = {
    ...event,
    title: "Last-day watch",
    startAt: timestampFromDate(new Date(bounds.to - 16 * HOUR)),
    endAt: timestampFromDate(new Date(bounds.to - 15 * HOUR)),
  };
  const message = create(MessageRecordSchema, {
    sourceMessageId: "SOURCE-1",
    events: [last, { ...last, id: 2n, title: "Unresolved", scheduleStatus: "needs_review" }],
  });
  const view = renderWithProviders(
    <DayTimeline
      messages={[message]}
      {...bounds}
      view="week"
      startHour={6}
      endHour={12}
      interval={30}
      returnTo="/calendar?view=week"
    />
  );
  expect(view.getByRole("button", { name: "Last-day watch, event details" })).toBeTruthy();
  expect(view.getByRole("button", { name: "Events in window (1) · Browse details" })).toBeTruthy();
  expect(view.container.querySelector(".week-fit")).toBeTruthy();
  expect(view.queryByRole("button", { name: "Unresolved, event details" })).toBeNull();
});
test("shared matching keeps all events from source-only matches and caps current future starts", () => {
  const events = Array.from({ length: 8 }, (_, i) => ({
    ...event,
    id: BigInt(i + 1),
    startAt: timestampFromDate(new Date(midnight + i * HOUR)),
    endAt: timestampFromDate(new Date(midnight + (i + 0.5) * HOUR)),
    isRevised: i === 3,
  }));
  const message = create(MessageRecordSchema, {
    sourceMessageId: "SOURCE-1",
    rawText: "Copper lantern",
    events: events.reverse(),
  });
  const result = discover([message], "COPPER LANTERN", midnight + HOUR);
  expect(result.messages[0].events).toHaveLength(8);
  expect(result.upcoming.map(({ event: e }) => e.id)).toEqual([2n, 3n, 4n, 5n, 6n]);
  expect(discover([message], "no match", midnight).messages).toHaveLength(0);
  const unresolved = create(MessageRecordSchema, {
    sourceMessageId: "REVIEW",
    processingStatus: "needs_review",
    rawText: "pending coordination",
  });
  expect(discover([unresolved], "pending", midnight).review).toHaveLength(1);
  expect(discover([unresolved], "pending", midnight).upcoming).toHaveLength(0);
  expect(discover([message], "", midnight + 100 * HOUR).upcoming).toHaveLength(0);
});
test("continuous geometry clips without rounding and excludes invalid intervals", () => {
  const full = geometry(event, midnight, midnight + 24 * HOUR)!;
  expect(full.left).toBeCloseTo((8.25 / 24) * 100);
  expect(full.width).toBeCloseTo((0.25 / 24) * 100);
  const clipped = geometry(event, midnight + 8.3 * HOUR, midnight + 9 * HOUR)!;
  expect(clipped.left).toBe(0);
  expect(clipped.before).toBe(true);
  expect(clipped.width).toBeCloseTo((0.2 / 0.7) * 100);
  expect(
    geometry({ ...event, scheduleStatus: "needs_review" }, midnight, midnight + 24 * HOUR)
  ).toBeNull();
  expect(geometry({ ...event, endAt: event.startAt }, midnight, midnight + 24 * HOUR)).toBeNull();
  expect(geometry(event, midnight + 8.5 * HOUR, midnight + 9 * HOUR)).toBeNull();
  expect(utcDate("2026-02-30", "2026-11-04")).toBe("2026-11-04");
});
test("compact cards keep exact times on hover and authoritative source links", () => {
  const message = create(MessageRecordSchema, { sourceMessageId: "SOURCE-1", events: [event] });
  const view = renderWithProviders(
    <DayTimeline
      messages={[message]}
      from={midnight}
      to={midnight + 24 * HOUR}
      interval={30}
      returnTo="/calendar?date=2026-11-04&q=watch"
    />
  );
  const card = view.getByRole("link", { name: "Short event, source record" });
  expect(card.textContent).toBe("Short event");
  expect(card.getAttribute("title")).toContain("2026-11-04 08:15 UTC");
  expect(view.queryByRole("heading", { name: /Exact event details/ })).toBeNull();
  expect(view.container.querySelector(".calendar-details")).toBeNull();
  expect(
    view.getByRole("link", { name: "Short event, source record" }).getAttribute("href")
  ).toContain("record=SOURCE-1");
});

test("Day source links and Week detail buttons are the only interactive event targets", () => {
  const message = create(MessageRecordSchema, {
    sourceMessageId: "SOURCE-1",
    events: [{ ...event, isRevised: true }],
  });
  for (const mode of ["day", "week"] as const) {
    const view = renderWithProviders(
      <DayTimeline
        messages={[message]}
        from={midnight}
        to={midnight + 24 * HOUR}
        interval={30}
        view={mode}
        returnTo="/calendar?date=2026-11-04"
      />
    );
    const target =
      mode === "week"
        ? view.getByRole("button", { name: "Short event, event details", exact: true })
        : view.getByRole("link", { name: "Short event, source record", exact: true });
    expect(target.closest('[role="button"]')).toBeNull();
    expect(target.querySelectorAll("a, button, [tabindex]").length).toBe(0);
    const wrapper = target.closest(".rbc-event")!;
    expect(wrapper.hasAttribute("tabindex")).toBe(false);
    expect(wrapper.querySelectorAll('a, button, [tabindex="0"]').length).toBe(1);
    expect(target.getAttribute("title")).toContain("Revised");
    expect(target.textContent).toBe("Short event");
    if (mode === "week") {
      expect(target.tagName).toBe("BUTTON");
      expect(wrapper.querySelector("a")).toBeNull();
    } else {
      expect(target.getAttribute("href")).toContain("record=SOURCE-1");
      expect(target.getAttribute("title")).toContain("2026-11-04 08:15 UTC");
    }
    view.unmount();
  }
});

for (const calendarView of ["day", "week", "month"] as const) {
  test(`calendar page retains the full ${calendarView} grid while source data is empty or loading`, () => {
    const view = renderWithProviders(<Calendar />, {
      route: `/calendar?date=2008-11-04&view=${calendarView}`,
    });
    expect(view.getByRole("region", { name: "Zulu UTC calendar, scrollable" })).toBeTruthy();
    expect(view.queryByRole("heading", { name: "Calendar", exact: true })).toBeNull();
    expect(
      view.container.querySelector(calendarView === "month" ? ".rbc-month-view" : ".rbc-time-view")
    ).toBeTruthy();
    expect(view.queryByText(/No timed events/)).toBeNull();
    expect(view.queryByText(/Ship schedule/)).toBeNull();
    if (calendarView === "month") {
      expect(view.container.querySelectorAll(".rbc-day-bg").length).toBeGreaterThanOrEqual(28);
    }
  });
}
