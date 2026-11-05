import "../route-registry";
import { expect, spyOn, test } from "bun:test";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderWithProviders, testSession } from "../test-utils/render-workflow";
import { SessionContext } from "./workflow-session";
import Calendar from "../pages/calendar";
import type { PlanningView } from "./personnel-planning";
import type { AnchorVersion, CurrentEventView } from "./anchor-data";

const at = (clock: string) => `2026-11-10T${clock}:00Z`;
const interval = (start: string, end: string) => ({ start: at(start), end: at(end) });
const sourceKey = `sha256:${"b".repeat(64)}@fictional-amendment-r1`;
function planning(): PlanningView {
  return {
    configured: true,
    canCoordinate: true,
    version: 7,
    inputVersion: "current-inputs",
    scenarioNow: at("09:01"),
    inputs: {
      people: [
        {
          id: "P-01",
          name: "Meridian training operator",
          qualifications: ["TRAINING"],
          availability: [interval("09:00", "12:00")],
        },
      ],
      events: [
        {
          id: "communications",
          title: "Communications window",
          interval: interval("10:30", "11:15"),
          personIds: ["P-01"],
          requiredQualifications: ["TRAINING"],
          fixed: true,
          sourceRef: sourceKey,
          version: "current-amendment",
          validated: false,
          bufferBeforeMinutes: null,
          bufferAfterMinutes: null,
        },
        {
          id: "training",
          title: "Local training",
          interval: interval("10:45", "11:15"),
          personIds: ["P-01"],
          requiredQualifications: ["TRAINING"],
          fixed: false,
          sourceRef: "local:training@1",
          version: "local-plan-1",
          validated: true,
          bufferBeforeMinutes: null,
          bufferAfterMinutes: null,
        },
      ],
      rules: {
        eventId: "training",
        window: interval("09:00", "12:00"),
        earliestStart: at("10:45"),
        durationMinutes: 30,
        gridMinutes: 15,
      },
      rosterObservedAt: at("08:00"),
      rosterValidUntil: at("12:00"),
      assessedAt: at("09:01"),
      scheduleComplete: true,
      coverage: interval("09:00", "12:00"),
    },
    assessment: {
      status: "feasible",
      provisional: true,
      collisions: [
        {
          personId: "P-01",
          eventIds: ["communications", "training"],
          overlap: interval("10:45", "11:15"),
          includesBuffer: false,
        },
      ],
      alternative: interval("11:15", "11:45"),
      explanation: [
        "Earliest later slot preserves 30 minutes, qualifications and availability. Fixed communications remain unchanged.",
      ],
      checkedStarts: 3,
    },
    proposals: [],
    decisions: [],
  };
}
const originalSource = `sha256:${"c".repeat(64)}@fictional-original-r1`;
const original: AnchorVersion = {
  id: "original",
  source: { messageKey: originalSource, contentHash: originalSource.split("@")[0]!, factId: "a1" },
  relationship: { kind: "original" },
  effectiveAt: at("07:00"),
  interval: interval("09:00", "09:45"),
  provenance: "Explicit authored original",
  parsedReviewRequired: true,
};
const amendment: AnchorVersion = {
  id: "amendment",
  source: { messageKey: sourceKey, contentHash: sourceKey.split("@")[0]!, factId: "a1" },
  relationship: { kind: "amends", target: "original" },
  effectiveAt: at("08:30"),
  interval: interval("10:30", "11:15"),
  provenance: "Explicit whole-event amendment",
  parsedReviewRequired: true,
};
const currentEvent: CurrentEventView = {
  logicalEventId: "meridian-2026-11-10:original",
  status: "active",
  versionToken: "current-amendment",
  current: amendment,
  original,
  previous: original,
  history: [original, amendment],
  nextEffectiveAt: null,
  problems: [],
  taskId: "communications:review",
  taskVersion: 4,
  eventVersion: 2,
  canReview: true,
  reviewed: false,
  reviews: [
    {
      actor: "test-coordinator",
      responsibilityId: "OPS",
      source: original.source,
      eventVersion: 1,
      recordedAt: "2026-11-05T09:59:00Z",
      currentVersionToken: "original-version",
    },
  ],
};
const timeline = {
  messages: [
    { id: "1", sourceMessageId: sourceKey, subject: "Synthetic amended communications window" },
  ],
  meta: {
    currentEvents: [currentEvent],
    timelineItems: [
      {
        key: `${sourceKey}#a1`,
        messageKey: sourceKey,
        factId: "a1",
        title: "Communications window",
        kind: "interval",
        start: at("10:30"),
        end: at("11:15"),
        reviewRequired: true,
      },
    ],
    reviewItems: [],
    windowLimited: false,
  },
};

for (const decision of ["accept", "reject"] as const) {
  test(`rendered Calendar ${decision}s a personnel proposal and reloads its saved local plan`, async () => {
    const state = planning();
    const writes: unknown[] = [];
    const unexpected: string[] = [];
    let planningReads = 0;
    let timelineReads = 0;
    const fetch = spyOn(globalThis, "fetch").mockImplementation(async (path, init) => {
      const url = String(path);
      if (url.endsWith("/commands/list"))
        return Response.json({
          commands: [],
          source: "fictional test",
          version: "1",
          provenance: "Synthetic calendar interaction test",
          assignmentEnabled: false,
        });
      if (url.endsWith("/messages/timeline")) {
        timelineReads++;
        return Response.json(timeline);
      }
      if (url.endsWith("/changes/list"))
        return Response.json({
          items: [],
          unknownTime: [],
          unknownHiddenCount: 0,
          unknownLimited: false,
          returnedNewCount: 0,
          hiddenCount: 0,
          hiddenShipIds: [],
          nextBefore: null,
          watermark: 0,
          since: at("00:00"),
          until: at("09:01"),
          availability: {
            newRecords: "available",
            amended: "unavailable",
            cancelled: "unavailable",
            reviewTransitions: "unavailable",
          },
          scope: "Fictional test",
        });
      if (url.endsWith("/planning/read")) {
        planningReads++;
        return Response.json(structuredClone(state));
      }
      if (url.endsWith("/planning/propose")) {
        writes.push(JSON.parse(String(init?.body)));
        state.version++;
        state.proposals.push({
          id: "training-proposal",
          inputVersion: "current-inputs",
          status: "pending",
          alternative: interval("11:15", "11:45"),
          actor: "test-coordinator",
          createdAt: "2026-11-05T10:00:00Z",
        });
        return Response.json(structuredClone(state));
      }
      if (url.endsWith("/planning/decide")) {
        const body = JSON.parse(String(init?.body));
        writes.push(body);
        state.version++;
        state.proposals[0]!.status = decision === "accept" ? "accepted" : "rejected";
        state.decisions.push({
          proposalId: "training-proposal",
          decision,
          actor: "test-coordinator",
          recordedAt: "2026-11-05T10:01:00Z",
          inputVersion: "current-inputs",
          reason: body.reason,
        });
        if (decision === "accept") {
          state.inputVersion = "accepted-inputs";
          state.inputs!.events[1]!.interval = interval("11:15", "11:45");
          state.inputs!.events[1]!.version = "local-plan-2";
          state.assessment = {
            ...state.assessment!,
            status: "clear",
            collisions: [],
            alternative: null,
            explanation: ["No conflict under the declared constraints."],
            checkedStarts: 0,
          };
        }
        return Response.json(structuredClone(state));
      }
      unexpected.push(url);
      return Response.json({ message: `Unexpected test request: ${url}` }, { status: 500 });
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const session = {
      ...testSession,
      settings: { ...testSession.settings, calendarRefreshSeconds: 0 as const },
    };
    const view = renderWithProviders(
      <SessionContext.Provider
        value={{
          session,
        }}
      >
        <QueryClientProvider client={client}>
          <Calendar />
        </QueryClientProvider>
      </SessionContext.Provider>,
      { route: "/calendar?date=2026-11-10&view=day" }
    );
    try {
      await waitFor(() =>
        expect(
          view.getByRole("link", { name: "Communications window, source record" })
        ).toBeTruthy()
      );
      await waitFor(() =>
        expect(view.getByRole("button", { name: "Calculate and save proposal" })).toBeEnabled()
      );
      expect(view.getByRole("region", { name: "Message history and version review" })).toBeTruthy();
      expect(view.getByText(/Time changed:/).textContent).toContain(
        "09:00–09:45 UTC → 2026-11-10 10:30–11:15 UTC"
      );
      const beforeSource = view.getByRole("link", { name: "Communications window, source record" });
      const sourceTitle = beforeSource.getAttribute("title");
      const sourceHref = beforeSource.getAttribute("href");
      expect(sourceTitle).toContain("10:30");
      expect(
        view.getByRole("link", { name: "Local training, local plan" }).getAttribute("title")
      ).toContain("10:45");
      expect(
        view.getByRole("link", { name: "Local training, local plan" }).getAttribute("href")
      ).toContain("#personnel-planning-heading");
      expect(
        within(view.getByRole("article", { name: "Local training" })).getByText(
          "2026-11-10 10:45–11:15 UTC"
        )
      ).toBeTruthy();
      fireEvent.click(view.getByRole("button", { name: "Calculate and save proposal" }));
      const label = decision === "accept" ? "Accept local training move" : "Reject proposal";
      await waitFor(() => expect(view.getByRole("button", { name: label })).toBeEnabled());
      fireEvent.click(view.getByRole("button", { name: label }));
      await waitFor(() =>
        expect(view.getByRole("heading", { name: "Planning decision history" })).toBeTruthy()
      );
      const expected =
        decision === "accept" ? "2026-11-10 11:15–11:45 UTC" : "2026-11-10 10:45–11:15 UTC";
      expect(
        within(view.getByRole("article", { name: "Local training" })).getByText(expected)
      ).toBeTruthy();
      expect(
        within(view.getByRole("article", { name: "Communications window" })).getByText(
          "2026-11-10 10:30–11:15 UTC"
        )
      ).toBeTruthy();
      const afterSource = view.getByRole("link", { name: "Communications window, source record" });
      const localBlock = view.getByRole("link", { name: "Local training, local plan" });
      expect(localBlock.getAttribute("title")).toContain(decision === "accept" ? "11:45" : "10:45");
      expect(localBlock.getAttribute("title")).toContain(
        "Local training plan — separately authored"
      );
      expect(afterSource.getAttribute("title")).toBe(sourceTitle);
      expect(afterSource.getAttribute("href")).toBe(sourceHref);
      expect(planningReads).toBeGreaterThanOrEqual(3);
      expect(timelineReads).toBeGreaterThanOrEqual(3);
      expect(view.getByText("Current version review required.")).toBeTruthy();
      expect(writes).toEqual([
        { expectedVersion: 7 },
        { expectedVersion: 8, proposalId: "training-proposal", decision, reason: "" },
      ]);
      expect(unexpected).toEqual([]);
    } finally {
      view.unmount();
      client.clear();
      fetch.mockRestore();
    }
  });
}

for (const mode of ["day", "week", "month"] as const) {
  test(`saved local training is a calendar block in ${mode} view`, async () => {
    const state = planning();
    state.inputs!.events[1]!.interval = interval("11:15", "11:45");
    const fetch = spyOn(globalThis, "fetch").mockImplementation(async (input) =>
      Response.json(String(input).endsWith("/planning/read") ? state : { messages: [], meta: {} })
    );
    const view = renderWithProviders(<Calendar />, {
      route: `/calendar?date=2026-11-10&view=${mode}`,
    });
    try {
      const role = mode === "week" ? "button" : "link";
      const name = mode === "week" ? "Local training, event details" : "Local training, local plan";
      await waitFor(() =>
        expect(view.getByRole(role, { name }).getAttribute("title")).toContain("11:45")
      );
      expect(view.queryByRole("link", { name: "Local training, source record" })).toBeNull();
    } finally {
      view.unmount();
      fetch.mockRestore();
    }
  });
}
for (const route of [
  "/calendar?date=2026-11-11&view=day",
  "/calendar?date=2026-12-10&view=month",
  `/calendar?date=2026-11-10&ships=${encodeURIComponent(JSON.stringify(["unit:other-command"]))}`,
  "/calendar?date=2026-11-10&ships=%5B%5D",
  "/calendar?date=2026-11-10&ships=invalid",
  "/calendar?date=2026-11-10&dataset=legacy",
]) {
  test(`planning does not leak outside selected date, command or source: ${route}`, async () => {
    let planningReads = 0;
    let timelineReads = 0;
    const fetch = spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input).endsWith("/planning/read")) {
        planningReads++;
        return Response.json(planning());
      }
      timelineReads++;
      return Response.json({ messages: [], meta: {} });
    });
    const view = renderWithProviders(<Calendar />, { route });
    try {
      await waitFor(() => expect(timelineReads).toBe(1));
      expect(planningReads).toBe(0);
      expect(view.queryByRole("region", { name: "Personnel planning" })).toBeNull();
      expect(view.queryByRole("link", { name: "Local training, local plan" })).toBeNull();
    } finally {
      view.unmount();
      fetch.mockRestore();
    }
  });
}
