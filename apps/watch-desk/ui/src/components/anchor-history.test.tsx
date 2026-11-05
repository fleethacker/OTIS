import { expect, spyOn, test } from "bun:test";
import { act, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../test-utils/render-workflow";
import { AnchorEvents, AnchorHistory } from "./anchor-history";
import type { AnchorResponse, AnchorVersion, CurrentEventView } from "./anchor-data";

const original: AnchorVersion = {
  id: "original",
  source: {
    messageKey: "sha256:original@r1",
    contentHash: "sha256:original",
    factId: "activity-1",
  },
  relationship: { kind: "original" },
  effectiveAt: "2026-11-10T07:00:00Z",
  interval: { start: "2026-11-10T09:00:00Z", end: "2026-11-10T09:45:00Z" },
  provenance: "Explicit synthetic original declaration",
  parsedReviewRequired: true,
};
const amendment: AnchorVersion = {
  ...original,
  id: "amendment",
  source: { messageKey: "sha256:amended@r1", contentHash: "sha256:amended", factId: "activity-2" },
  relationship: { kind: "amends", target: "original" },
  effectiveAt: "2026-11-10T08:00:00Z",
  interval: { start: "2026-11-10T10:30:00Z", end: "2026-11-10T11:15:00Z" },
  provenance: "Explicit whole-event replacement",
};
const cancellation: AnchorVersion = {
  ...original,
  id: "cancellation",
  source: { messageKey: "sha256:cancelled@r1", contentHash: "sha256:cancelled", factId: null },
  relationship: { kind: "cancels", target: "amendment" },
  effectiveAt: "2026-11-10T12:00:00Z",
  interval: null,
  provenance: "Explicit cancellation declaration",
};
function event(overrides: Partial<CurrentEventView> = {}): CurrentEventView {
  return {
    logicalEventId: "meridian:communications",
    status: "active",
    versionToken: "anchor:v1:amended",
    current: amendment,
    original,
    previous: original,
    history: [original, amendment],
    nextEffectiveAt: null,
    problems: [],
    taskId: "work-1",
    taskVersion: 7,
    eventVersion: 2,
    canReview: true,
    reviewed: false,
    reviews: [
      {
        actor: "demo:watchstander",
        responsibilityId: "ops",
        source: original.source,
        eventVersion: 1,
        recordedAt: "2026-11-10T07:15:00Z",
        currentVersionToken: "anchor:v1:original",
      },
    ],
    ...overrides,
  };
}
function payload(item = event()): AnchorResponse {
  return {
    scenarioId: "meridian-20261110",
    scenarioNow: "2026-11-10T08:15:00Z",
    version: 3,
    configured: true,
    complete: true,
    coverage: "Explicit bounded scenario",
    items: [item],
  };
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("reader shows exact before/after sources and records only the current version review", async () => {
  const requests: Array<{ path: string; body: unknown }> = [];
  let reviewed = false;
  const fetch = spyOn(globalThis, "fetch").mockImplementation(async (path, init) => {
    requests.push({ path: String(path), body: JSON.parse(String(init?.body)) });
    if (String(path) === "/api/v1/work/review") {
      reviewed = true;
      return json({});
    }
    return json(payload(event({ reviewed })));
  });
  const view = renderWithProviders(<AnchorHistory messageKey={original.source.messageKey} />);
  try {
    await waitFor(() =>
      expect(view.queryByText(/Time changed:/)?.textContent).toContain(
        "09:00–09:45 UTC → 2026-11-10 10:30–11:15 UTC"
      )
    );
    expect(requests[0]).toEqual({
      path: "/api/v1/anchor/current",
      body: { messageKey: original.source.messageKey },
    });
    const source = view.getByRole("link", { name: "Amendment source", hidden: true });
    expect(
      new URL(source.getAttribute("href")!, "http://localhost").searchParams.get("record")
    ).toBe(amendment.source.messageKey);
    expect(view.getAllByText("Parsed facts remain unvalidated.").length).toBeGreaterThan(0);
    expect(view.getByText(/Earlier version/)).toBeTruthy();
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Reviewed this version" }));
    });
    await waitFor(() => expect(view.queryByText("Current version review required.")).toBeNull());
    await waitFor(() => expect(view.getByText("Reviewed this version")).toBeTruthy());
    expect(requests.find((request) => request.path === "/api/v1/work/review")?.body).toEqual({
      taskId: "work-1",
      expectedVersion: 7,
      eventVersion: 2,
      currentVersionToken: "anchor:v1:amended",
    });
    expect(requests.some((request) => request.path.includes("preparation"))).toBe(false);
    expect(requests.filter((request) => request.path === "/api/v1/anchor/current").length).toBe(2);
    expect(
      view.getByText(/does not complete the task, validate parsed facts, or send a message/)
    ).toBeTruthy();
  } finally {
    view.unmount();
    fetch.mockRestore();
  }
});

test("stale review is rejected visibly and refreshes the current event", async () => {
  const fetch = spyOn(globalThis, "fetch").mockImplementation(async (path) =>
    String(path) === "/api/v1/work/review"
      ? json({ code: "aborted", message: "Current version changed" }, 409)
      : json(payload())
  );
  const view = renderWithProviders(<AnchorHistory messageKey={amendment.source.messageKey} />);
  try {
    await waitFor(() =>
      expect(view.queryByText("Current version review required.")).not.toBeNull()
    );
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Reviewed this version" }));
    });
    await waitFor(() =>
      expect(view.queryByText(/Review was not recorded./)?.textContent).toContain(
        "Review was not recorded. Current version changed"
      )
    );
    expect(
      view.getByRole("button", { name: "Reviewed this version" }).hasAttribute("disabled")
    ).toBe(true);
    expect(
      fetch.mock.calls.filter(([path]) => String(path) === "/api/v1/anchor/current").length
    ).toBe(2);
  } finally {
    view.unmount();
    fetch.mockRestore();
  }
});

test("a transient review failure can reload and retry the same current task version", async () => {
  let attempts = 0;
  const fetch = spyOn(globalThis, "fetch").mockImplementation(async () => {
    attempts += 1;
    return attempts === 1
      ? json({ code: "unavailable", message: "State storage unavailable" }, 503)
      : json({});
  });
  const view = renderWithProviders(<AnchorEvents items={[event()]} />);
  try {
    await act(async () => {
      fireEvent.click(view.getByText("Reviewed this version"));
    });
    await waitFor(() =>
      expect(view.queryByText(/Review was not recorded. State storage unavailable/)).not.toBeNull()
    );
    await act(async () => {
      fireEvent.click(view.getByText("Reload current version"));
    });
    await waitFor(() => expect(view.queryByText(/Review was not recorded./)).toBeNull());
    expect(view.getByText("Reviewed this version").hasAttribute("disabled")).toBe(false);
    await act(async () => {
      fireEvent.click(view.getByText("Reviewed this version"));
    });
    await waitFor(() => expect(attempts).toBe(2));
    await waitFor(() => expect(view.queryByText("Recording review…")).toBeNull());
    expect(view.queryByText(/Review was not recorded./)).toBeNull();
    expect(fetch.mock.calls.map(([, init]) => JSON.parse(String(init?.body)))).toEqual([
      {
        taskId: "work-1",
        expectedVersion: 7,
        eventVersion: 2,
        currentVersionToken: "anchor:v1:amended",
      },
      {
        taskId: "work-1",
        expectedVersion: 7,
        eventVersion: 2,
        currentVersionToken: "anchor:v1:amended",
      },
    ]);
  } finally {
    view.unmount();
    fetch.mockRestore();
  }
});

test("pre-ANCHOR review is current only for the exact original event version and source", () => {
  const legacy = { ...event().reviews[0], currentVersionToken: null };
  const base = event({
    current: original,
    previous: null,
    history: [original],
    versionToken: "anchor:v1:original",
    eventVersion: 1,
    reviewed: true,
    reviews: [legacy],
  });
  for (const [item, expected] of [
    [base, "Current version"],
    [{ ...base, eventVersion: 2 }, "Earlier version"],
    [
      { ...base, reviews: [{ ...legacy, source: { ...legacy.source, factId: "different-fact" } }] },
      "Earlier version",
    ],
    [
      {
        ...base,
        reviews: [
          { ...legacy, source: { ...legacy.source, messageKey: amendment.source.messageKey } },
        ],
      },
      "Earlier version",
    ],
  ] as const) {
    const view = renderWithProviders(<AnchorEvents items={[item]} />);
    expect(view.getByText(/demo:watchstander/).textContent).toContain(expected);
    view.unmount();
  }
});

test("cancellation retains review work and all source history without active scheduling", () => {
  const view = renderWithProviders(
    <AnchorEvents
      items={[
        event({
          status: "cancelled",
          current: cancellation,
          previous: amendment,
          history: [original, amendment, cancellation],
          versionToken: "anchor:v1:cancelled",
          eventVersion: 3,
        }),
      ]}
    />
  );
  expect(view.getByText("Event cancelled")).toBeTruthy();
  expect(view.getByText(/Removed from the active schedule/)).toBeTruthy();
  expect(view.getByText("Cancellation review required.")).toBeTruthy();
  expect(view.getByRole("button", { name: "Reviewed this version" })).toBeTruthy();
  expect(view.getByRole("link", { name: "Cancellation source", hidden: true })).toBeTruthy();
  expect(view.queryByText("Current event")).toBeNull();
});

test("unresolved lineage exposes ambiguity and provides no review action", () => {
  const view = renderWithProviders(
    <AnchorEvents
      complete={false}
      items={[
        event({
          status: "unresolved",
          current: null,
          previous: null,
          versionToken: null,
          problems: ["conflicting_branches"],
          canReview: true,
        }),
      ]}
    />
  );
  expect(view.getByText("Current version unresolved")).toBeTruthy();
  expect(view.getByText(/No current instruction selected. conflicting branches/)).toBeTruthy();
  expect(view.getByRole("alert").textContent).toContain("coverage is incomplete");
  expect(view.queryByRole("button", { name: "Reviewed this version" })).toBeNull();
  expect(view.getByRole("link", { name: "Original source", hidden: true })).toBeTruthy();
});

test("future amendment keeps original current and displays effective time", () => {
  const view = renderWithProviders(
    <AnchorEvents
      items={[
        event({
          current: original,
          previous: null,
          versionToken: "anchor:v1:original",
          nextEffectiveAt: amendment.effectiveAt,
          eventVersion: 1,
          reviewed: true,
        }),
      ]}
    />
  );
  expect(view.getByText("Next declared change takes effect 2026-11-10 08:00 UTC.")).toBeTruthy();
  expect(view.getByText("Future version", { exact: false })).toBeTruthy();
  expect(view.queryByText(/Time changed:/)).toBeNull();
  expect(view.queryByRole("button", { name: "Reviewed this version" })).toBeNull();
});

test("denied and malformed history fail closed", async () => {
  for (const response of [
    json({ code: "permission_denied", message: "Source outside your scope" }, 403),
    json({ ...payload(), items: [{ ...event(), current: { ...amendment, source: null } }] }),
  ]) {
    const fetch = spyOn(globalThis, "fetch").mockImplementation(async () => response);
    const view = renderWithProviders(<AnchorHistory messageKey={amendment.source.messageKey} />);
    try {
      await waitFor(() =>
        expect(view.getByRole("alert").textContent).toContain("Message history unavailable")
      );
      expect(view.queryByRole("button", { name: "Reviewed this version" })).toBeNull();
      expect(view.queryByText("Current event")).toBeNull();
    } finally {
      view.unmount();
      fetch.mockRestore();
    }
  }
});

test("review permission comes from server and source provenance renders as text", () => {
  const unsafe = {
    ...amendment,
    provenance: '<img src=x onerror="alert(1)"> authored declaration',
  };
  const view = renderWithProviders(
    <AnchorEvents
      items={[event({ current: unsafe, history: [original, unsafe], canReview: false })]}
    />
  );
  expect(view.getByText("Your account cannot record this review.")).toBeTruthy();
  expect(view.queryByRole("button", { name: "Reviewed this version" })).toBeNull();
  expect(view.container.querySelector("img, script")).toBeNull();
});
