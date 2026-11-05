import "../route-registry";
import { expect, spyOn, test } from "bun:test";
import { act, fireEvent, waitFor } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { createRouterTransport } from "@connectrpc/connect";
import { TransportProvider } from "@connectrpc/connect-query";
import { MessageRecordSchema } from "../gen/app/v1/models_pb";
import { AppService } from "../gen/app/v1/app_pb";
import { DraftService } from "../gen/app/v1/drafts_pb";
import { renderWithProviders } from "../test-utils/render-workflow";
import { MessageReader } from "./message-reader";
import AssignedWork from "../pages/assigned-work";
import Calendar from "../pages/calendar";
import {
  readAnchor,
  type AnchorResponse,
  type AnchorVersion,
  type CurrentEventView,
} from "./anchor-data";
import type { WorkList, WorkTask } from "./work-data";
import { readSource } from "./source-data";
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

function work(current: CurrentEventView): WorkList {
  const task: WorkTask = {
    id: "work-1",
    logicalEventId: current.logicalEventId,
    version: 7,
    eventVersion: 2,
    source: amendment.source,
    currentVersionToken: current.versionToken,
    instructionStatus: "active",
    remindersActive: true,
    currentEvent: current,
    action: "Review Meridian communications amendment",
    commandId: "demo-meridian",
    responsibilityId: "ops",
    responsibilityName: "OPS",
    ownerId: "test-user",
    ownerName: "Local owner",
    personId: "P-01",
    ruleId: "synthetic-ops",
    assignmentReason: "Explicit Meridian OPS rule",
    dueAt: "2026-11-10T09:00:00Z",
    dueBasis: "Local demo policy",
    start: amendment.interval!.start,
    end: amendment.interval!.end,
    sourceExcerpt: "Synthetic communications amendment",
    sourceContacts: [],
    sourceStatus: "partial",
    factStatus: "unvalidated",
    reviewFlags: ["record_review"],
    progress: "not_started",
    reviews: [],
    history: [],
    canAct: true,
    reviewed: false,
    overdue: false,
  };
  return {
    configured: true,
    canCoordinate: false,
    scenarioId: "meridian",
    scenarioNow: "2026-11-10T08:15:00Z",
    version: 2,
    pendingSources: [],
    items: [task],
  };
}

test("reader version review refreshes shared work while private acknowledgements stay unsent", async () => {
  const current = event();
  const data = work(current);
  let workReads = 0;
  let privateWrites = 0;
  const requests: { path: string; body: unknown }[] = [];
  const fetch = spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const path = String(input);
    if (path.endsWith("/work/list")) {
      workReads += 1;
      return json(data);
    }
    if (path.endsWith("/anchor/current")) return json(payload(current));
    requests.push({ path, body: JSON.parse(String(init?.body)) });
    if (!path.endsWith("/work/review")) throw new Error(`Unexpected request ${path}`);
    current.reviewed = true;
    current.taskVersion = 8;
    data.items[0].reviewed = true;
    data.items[0].version = 8;
    data.items[0].reviews = [
      {
        actor: "test-user",
        responsibilityId: "ops",
        source: amendment.source,
        eventVersion: 2,
        recordedAt: "2026-11-05T12:00:00Z",
      },
    ];
    return json({ item: data.items[0] });
  });
  const transport = createRouterTransport((router) => {
    router.service(AppService, {
      getIdentity: () => ({ username: "Test watchstander", role: "viewer" }),
    });
    router.service(DraftService, {
      readPreparation: () => ({
        fieldsJson: "{}",
        generatedText: "",
        acknowledged: false,
        historyJson: "[]",
      }),
      savePreparation: () => {
        privateWrites += 1;
        return {};
      },
    });
  });
  const view = renderWithProviders(
    <TransportProvider transport={transport}>
      <MessageReader
        message={create(MessageRecordSchema, {
          sourceMessageId: original.source.messageKey,
          subject: "Original communications window",
          rawText: "Synthetic original evidence",
          processingStatus: "needs_review",
        })}
      />
      <AssignedWork />
    </TransportProvider>
  );
  try {
    await waitFor(() => expect(view.queryByText("Review required")).not.toBeNull());
    await waitFor(() => expect(view.queryByText("Not acknowledged")).not.toBeNull());
    const controls = view.getAllByRole("button", { name: "Reviewed this version" });
    expect(controls).toHaveLength(2);
    await act(async () => {
      fireEvent.click(controls[0]);
    });
    await waitFor(() => expect(workReads).toBe(2));
    await waitFor(() => expect(view.queryByText("Version reviewed")).not.toBeNull());
    expect(view.getByText("Not started", { selector: "span" })).toBeTruthy();
    expect(view.getByText("Not acknowledged")).toBeTruthy();
    expect(privateWrites).toBe(0);
    expect(requests).toEqual([
      {
        path: "/api/v1/work/review",
        body: {
          taskId: "work-1",
          expectedVersion: 7,
          eventVersion: 2,
          currentVersionToken: "anchor:v1:amended",
        },
      },
    ]);
  } finally {
    view.unmount();
    fetch.mockRestore();
  }
});

test("calendar consumes current intervals and cancellation refresh removes the active event", async () => {
  let current = event();
  const fetch = spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    if (String(input).endsWith("/commands/list"))
      return json({
        commands: [],
        source: "test",
        version: "test",
        provenance: "synthetic",
        assignmentEnabled: false,
      });
    if (!String(input).endsWith("/messages/timeline"))
      throw new Error(`Unexpected request ${String(input)}`);
    return json({
      messages: [{ id: "1", sourceMessageId: amendment.source.messageKey }],
      meta: {
        currentEvents: [current],
        reviewItems: [],
        windowLimited: false,
        timelineItems:
          current.status === "cancelled"
            ? []
            : [
                {
                  key: "current-comms",
                  messageKey: amendment.source.messageKey,
                  factId: "a1",
                  kind: "interval",
                  title: "Current communications window",
                  start: amendment.interval!.start,
                  end: amendment.interval!.end,
                  reviewRequired: true,
                },
              ],
      },
    });
  });
  const view = renderWithProviders(<Calendar />, { route: "/calendar?date=2026-11-10&view=day" });
  try {
    await waitFor(() => expect(view.queryByText(/Time changed:/)).not.toBeNull());
    expect(
      view
        .getByRole("link", { name: "Current communications window, source record" })
        .getAttribute("href")
    ).toContain(encodeURIComponent(amendment.source.messageKey));
    expect(view.getByText(/Time changed:/).textContent).toContain(
      "09:00–09:45 UTC → 2026-11-10 10:30–11:15 UTC"
    );
    current = {
      ...current,
      status: "cancelled",
      current: cancellation,
      previous: amendment,
      history: [original, amendment, cancellation],
      versionToken: "anchor:v1:cancelled",
      taskVersion: 8,
      eventVersion: 3,
    };
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Refresh calendar" }));
    });
    await waitFor(() => expect(view.queryByText("Event cancelled")).not.toBeNull());
    expect(
      view.queryByRole("link", { name: "Current communications window, source record" })
    ).toBeNull();
    expect(view.getByText("Cancellation review required.")).toBeTruthy();
    expect(view.getByRole("link", { name: "Original source", hidden: true })).toBeTruthy();
    expect(view.getByRole("button", { name: "Reviewed this version" })).toBeTruthy();
  } finally {
    view.unmount();
    fetch.mockRestore();
  }
});

test("task review submits the ANCHOR token once and retains unresolved task restrictions", async () => {
  const current = event();
  const data = work(current);
  const requests: unknown[] = [];
  const fetch = spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    if (String(input).endsWith("/work/list")) return json(data);
    requests.push(JSON.parse(String(init?.body)));
    return json({ message: "Current version changed; reload" }, 409);
  });
  const view = renderWithProviders(<AssignedWork />);
  try {
    await waitFor(() => expect(view.queryByText("Review required")).not.toBeNull());
    expect(view.getAllByRole("button", { name: "Reviewed this version" })).toHaveLength(1);
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Reviewed this version" }));
    });
    await waitFor(() => expect(view.queryByText("Current version changed; reload")).not.toBeNull());
    expect(requests).toEqual([
      {
        taskId: "work-1",
        expectedVersion: 7,
        eventVersion: 2,
        currentVersionToken: "anchor:v1:amended",
      },
    ]);
    data.items[0].canAct = false;
    data.items[0].currentEvent = {
      ...current,
      status: "unresolved",
      versionToken: null,
      current: null,
      previous: null,
      problems: ["conflicting_branches"],
      canReview: false,
    };
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Refresh work" }));
    });
    await waitFor(() => expect(view.queryByText("Current version unresolved")).not.toBeNull());
    expect(view.getByRole("button", { name: "Reviewed this version" })).toBeDisabled();
  } finally {
    view.unmount();
    fetch.mockRestore();
  }
});

test("unconfigured history response contains no current event", async () => {
  const fetch = spyOn(globalThis, "fetch").mockImplementation(async () =>
    json({
      scenarioId: "meridian",
      scenarioNow: "2026-11-10T08:15:00Z",
      version: 0,
      configured: false,
      complete: false,
      coverage: "Explicit synthetic event",
      items: [],
    })
  );
  try {
    expect((await readAnchor()).configured).toBe(false);
  } finally {
    fetch.mockRestore();
  }
});

test("malformed current-event metadata fails before calendar rendering", async () => {
  const fetch = spyOn(globalThis, "fetch").mockImplementation(async () =>
    json({ messages: [], meta: { currentEvents: [{ ...event(), current: { source: null } }] } })
  );
  try {
    await expect(
      readSource("timeline", {
        from: "2026-11-10T00:00:00Z",
        to: "2026-11-11T00:00:00Z",
      })
    ).rejects.toThrow("Current event results could not be verified");
  } finally {
    fetch.mockRestore();
  }
});
