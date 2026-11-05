import { expect, spyOn, test } from "bun:test";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderWithProviders, testSession } from "../test-utils/render-workflow";
import { SessionContext, type AccountSession } from "./workflow-session";
import { PersonnelPlanning, type PlanningView, type PlanningProposal } from "./personnel-planning";

const time = (value: string) => `2026-11-10T${value}:00Z`;
const interval = (start: string, end: string) => ({ start: time(start), end: time(end) });
const sourceKey = `sha256:${"a".repeat(64)}@1`;
function scenario(): PlanningView {
  return {
    configured: true,
    canCoordinate: true,
    version: 5,
    inputVersion: "inputs-1",
    scenarioNow: time("09:01"),
    inputs: {
      people: [
        {
          id: "P-01",
          name: "Fictional Meridian operator",
          qualifications: ["COMMS-TRAINING"],
          availability: [interval("09:00", "12:00")],
        },
      ],
      events: [
        {
          id: "communications",
          title: "Communications window",
          interval: interval("10:30", "11:15"),
          personIds: ["P-01"],
          requiredQualifications: ["COMMS-TRAINING"],
          fixed: true,
          sourceRef: sourceKey,
          version: "anchor-2",
          validated: false,
          bufferBeforeMinutes: null,
          bufferAfterMinutes: null,
        },
        {
          id: "local-training",
          title: "Local training",
          interval: interval("10:45", "11:15"),
          personIds: ["P-01"],
          requiredQualifications: ["COMMS-TRAINING"],
          fixed: false,
          sourceRef: "local:meridian-training@1",
          version: "local-1",
          validated: true,
          bufferBeforeMinutes: null,
          bufferAfterMinutes: null,
        },
      ],
      rules: {
        eventId: "local-training",
        window: interval("09:00", "12:00"),
        earliestStart: time("10:45"),
        durationMinutes: 30,
        gridMinutes: 15,
      },
      rosterObservedAt: time("08:00"),
      rosterValidUntil: time("12:00"),
      assessedAt: time("09:01"),
      scheduleComplete: true,
      coverage: interval("09:00", "12:00"),
    },
    assessment: {
      status: "feasible",
      provisional: true,
      collisions: [
        {
          personId: "P-01",
          eventIds: ["communications", "local-training"],
          overlap: interval("10:45", "11:15"),
          includesBuffer: false,
        },
      ],
      alternative: interval("11:15", "11:45"),
      explanation: [
        "Earliest feasible later slot; preserves 30 minutes within availability.",
        "No setup/rest buffer is declared; adjacent intervals are compatible.",
      ],
      checkedStarts: 3,
    },
    proposals: [],
    decisions: [],
  };
}
function proposal(): PlanningProposal {
  return {
    id: "proposal-1",
    inputVersion: "inputs-1",
    status: "pending",
    alternative: interval("11:15", "11:45"),
    createdAt: "2026-11-05T10:00:00Z",
    actor: "coordinator",
  };
}
function mount(session: AccountSession = testSession) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = renderWithProviders(
    <SessionContext.Provider
      value={{
        session,
      }}
    >
      <QueryClientProvider client={client}>
        <PersonnelPlanning />
      </QueryClientProvider>
    </SessionContext.Provider>
  );
  return {
    view,
    client,
    cleanup() {
      view.unmount();
      client.clear();
    },
  };
}

test("personnel panel shows exact people, source links, collision, feasible slot and constraints", async () => {
  const fetch = spyOn(globalThis, "fetch").mockImplementation(async () =>
    Response.json(scenario())
  );
  const { view, cleanup } = mount();
  try {
    await waitFor(() => expect(view.getByText("Personnel conflict: P-01")).toBeTruthy());
    expect(view.getByText("Overlap: 2026-11-10 10:45–11:15 UTC")).toBeTruthy();
    expect(
      view.getByText("Earliest feasible alternative: 2026-11-10 11:15–11:45 UTC")
    ).toBeTruthy();
    expect(view.getByText(/Provisional assessment/)).toBeTruthy();
    expect(view.getAllByText("No setup/rest buffer declared")).toHaveLength(2);
    expect(view.getByText(/30 minutes.*15-minute grid/)).toBeTruthy();
    const source = view.getByRole("link", { name: "View source: Communications window" });
    expect(source.getAttribute("href")).toContain(encodeURIComponent(sourceKey));
    expect(view.getByText("Local planning source: local:meridian-training@1")).toBeTruthy();
    expect(view.getByText(/Qualifications: COMMS-TRAINING/)).toBeTruthy();
  } finally {
    cleanup();
    fetch.mockRestore();
  }
});

test("saving then accepting a proposal sends versions and renders the persisted local plan", async () => {
  const state = scenario();
  const writes: Record<string, unknown>[] = [];
  const fetch = spyOn(globalThis, "fetch").mockImplementation(async (path, init) => {
    const body = JSON.parse(String(init?.body));
    if (String(path).endsWith("/propose")) {
      writes.push(body);
      state.proposals = [proposal()];
      state.version++;
    }
    if (String(path).endsWith("/decide")) {
      writes.push(body);
      state.version++;
      state.proposals[0]!.status = "accepted";
      state.inputs!.events[1]!.interval = interval("11:15", "11:45");
      state.assessment = {
        ...state.assessment!,
        status: "clear",
        collisions: [],
        alternative: null,
        explanation: ["No personnel conflict under the declared constraints."],
        checkedStarts: 0,
      };
      state.decisions.push({
        proposalId: "proposal-1",
        decision: "accept",
        actor: "coordinator",
        recordedAt: "2026-11-05T10:01:00Z",
        inputVersion: "inputs-1",
        reason: String(body.reason),
      });
    }
    return Response.json(structuredClone(state));
  });
  const { view, client, cleanup } = mount();
  const related = ["assigned-work", "anchor-current", "parse-command-source"];
  for (const family of related)
    client.setQueryData([family, "inactive-test-scope"], { loaded: true });
  try {
    await waitFor(() =>
      expect(view.getByRole("button", { name: "Calculate and save proposal" })).toBeEnabled()
    );
    fireEvent.click(view.getByRole("button", { name: "Calculate and save proposal" }));
    await waitFor(() =>
      expect(view.getByRole("button", { name: "Accept local training move" })).toBeEnabled()
    );
    fireEvent.change(view.getByLabelText("Decision reason (optional)"), {
      target: { value: "Preserve the fixed window" },
    });
    fireEvent.click(view.getByRole("button", { name: "Accept local training move" }));
    await waitFor(() =>
      expect(view.getByText(/Accepted local training move · coordinator/)).toBeTruthy()
    );
    expect(
      within(view.getByRole("article", { name: "Local training" })).getByText(
        "2026-11-10 11:15–11:45 UTC"
      )
    ).toBeTruthy();
    expect(
      within(view.getByRole("article", { name: "Communications window" })).getByText(
        "2026-11-10 10:30–11:15 UTC"
      )
    ).toBeTruthy();
    expect(view.queryByText("Personnel conflict: P-01")).toBeNull();
    for (const family of related) {
      expect(client.getQueryState([family, "inactive-test-scope"])?.isInvalidated).toBe(true);
    }
    expect(writes).toEqual([
      { expectedVersion: 5 },
      {
        expectedVersion: 6,
        proposalId: "proposal-1",
        decision: "accept",
        reason: "Preserve the fixed window",
      },
    ]);
  } finally {
    cleanup();
    fetch.mockRestore();
  }
});

test("rejecting a proposal records the decision and leaves both intervals unchanged", async () => {
  const state = scenario();
  state.proposals = [proposal()];
  const fetch = spyOn(globalThis, "fetch").mockImplementation(async (path, init) => {
    if (String(path).endsWith("/decide")) {
      const body = JSON.parse(String(init?.body));
      expect(body.decision).toBe("reject");
      state.version++;
      state.proposals[0]!.status = "rejected";
      state.decisions.push({
        proposalId: "proposal-1",
        decision: "reject",
        actor: "coordinator",
        recordedAt: "2026-11-05T10:01:00Z",
        inputVersion: "inputs-1",
        reason: "",
      });
    }
    return Response.json(structuredClone(state));
  });
  const { view, cleanup } = mount();
  try {
    await waitFor(() =>
      expect(view.getByRole("button", { name: "Reject proposal" })).toBeEnabled()
    );
    fireEvent.click(view.getByRole("button", { name: "Reject proposal" }));
    await waitFor(() => expect(view.getByText(/Rejected proposal · coordinator/)).toBeTruthy());
    expect(
      within(view.getByRole("article", { name: "Local training" })).getByText(
        "2026-11-10 10:45–11:15 UTC"
      )
    ).toBeTruthy();
    expect(view.getByText("Personnel conflict: P-01")).toBeTruthy();
    expect(view.queryByRole("button", { name: "Accept local training move" })).toBeNull();
  } finally {
    cleanup();
    fetch.mockRestore();
  }
});

test("incomplete assessment cannot offer or accept a new move", async () => {
  const state = scenario();
  state.inputs!.people[0]!.qualifications = null;
  state.inputs!.people[0]!.availability = null;
  state.inputs!.events[0]!.interval = null;
  state.inputs!.events[0]!.sourceRef = "";
  state.inputs!.events[0]!.version = "";
  state.assessment = {
    ...state.assessment!,
    status: "incomplete",
    alternative: null,
    explanation: ["Personnel inputs are stale."],
  };
  state.proposals = [proposal()];
  const fetch = spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(state));
  const { view, cleanup } = mount();
  try {
    await waitFor(() => expect(view.getByText(/Incomplete assessment —/)).toBeTruthy());
    expect(view.getByText("Source unresolved")).toBeTruthy();
    expect(view.getByText("Input version: unresolved")).toBeTruthy();
    expect(view.queryByRole("link", { name: "View source: Communications window" })).toBeNull();
    expect(view.getByRole("button", { name: "Calculate and save proposal" })).toBeDisabled();
    expect(view.getByRole("button", { name: "Accept local training move" })).toBeDisabled();
    expect(view.getByRole("button", { name: "Reject proposal" })).toBeEnabled();
  } finally {
    cleanup();
    fetch.mockRestore();
  }
});

test("stale acceptance displays server rejection without claiming a plan update", async () => {
  const state = scenario();
  state.proposals = [proposal()];
  const fetch = spyOn(globalThis, "fetch").mockImplementation(async (path) =>
    String(path).endsWith("/decide")
      ? Response.json(
          { message: "Proposal is stale; recalculate current inputs." },
          { status: 409 }
        )
      : Response.json(state)
  );
  const { view, cleanup } = mount();
  try {
    await waitFor(() =>
      expect(view.getByRole("button", { name: "Accept local training move" })).toBeEnabled()
    );
    fireEvent.click(view.getByRole("button", { name: "Accept local training move" }));
    await waitFor(() => expect(view.getByRole("alert").textContent).toContain("Proposal is stale"));
    expect(view.queryByText(/Decision saved/)).toBeNull();
    expect(
      within(view.getByRole("article", { name: "Local training" })).getByText(
        "2026-11-10 10:45–11:15 UTC"
      )
    ).toBeTruthy();
  } finally {
    cleanup();
    fetch.mockRestore();
  }
});

test("read-only users can inspect but receive no decision controls", async () => {
  const state = scenario();
  state.canCoordinate = false;
  state.proposals = [proposal()];
  const fetch = spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(state));
  const { view, cleanup } = mount();
  try {
    await waitFor(() => expect(view.getByText("Personnel conflict: P-01")).toBeTruthy());
    expect(view.queryByRole("button", { name: "Calculate and save proposal" })).toBeNull();
    expect(view.queryByRole("button", { name: "Accept local training move" })).toBeNull();
    expect(view.queryByRole("button", { name: "Reject proposal" })).toBeNull();
  } finally {
    cleanup();
    fetch.mockRestore();
  }
});

test("no schedule permission hides the panel and does not request planning data", () => {
  const fetch = spyOn(globalThis, "fetch");
  const { view, cleanup } = mount({ ...testSession, permissions: [] });
  try {
    expect(view.queryByRole("heading", { name: "Personnel planning" })).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    cleanup();
    fetch.mockRestore();
  }
});

test("a failed refresh hides previously read schedules and decision controls", async () => {
  const state = scenario();
  state.proposals = [proposal()];
  let denied = false;
  const fetch = spyOn(globalThis, "fetch").mockImplementation(async () =>
    denied
      ? Response.json({ message: "Source access denied." }, { status: 403 })
      : Response.json(state)
  );
  const { view, cleanup } = mount();
  try {
    await waitFor(() =>
      expect(view.getByRole("button", { name: "Accept local training move" })).toBeEnabled()
    );
    denied = true;
    fireEvent.click(view.getByRole("button", { name: "Refresh personnel planning" }));
    await waitFor(() =>
      expect(view.getByRole("alert").textContent).toContain("Source access denied")
    );
    expect(view.queryByRole("article", { name: "Local training" })).toBeNull();
    expect(view.queryByRole("button", { name: "Accept local training move" })).toBeNull();
  } finally {
    cleanup();
    fetch.mockRestore();
  }
});

test("malformed planning responses fail closed without rendering schedules or decisions", async () => {
  const malformed = [
    { messages: [], meta: {} },
    { ...scenario(), proposals: [{ ...proposal(), alternative: { start: time("11:15") } }] },
    "{invalid json",
  ];
  for (const payload of malformed) {
    const fetch = spyOn(globalThis, "fetch").mockImplementation(async () =>
      typeof payload === "string" ? new Response(payload) : Response.json(payload)
    );
    const { view, cleanup } = mount();
    try {
      await waitFor(() =>
        expect(view.getByRole("alert").textContent).toContain(
          "Personnel planning could not be checked"
        )
      );
      expect(view.queryByRole("article", { name: "Local training" })).toBeNull();
      expect(view.queryByRole("button", { name: "Calculate and save proposal" })).toBeNull();
      expect(view.queryByRole("button", { name: "Accept local training move" })).toBeNull();
    } finally {
      cleanup();
      fetch.mockRestore();
    }
  }
});

test("a malformed refresh removes cached planning controls and a malformed save never claims success", async () => {
  const state = scenario();
  state.proposals = [proposal()];
  let malformed = false;
  const fetch = spyOn(globalThis, "fetch").mockImplementation(async (path) => {
    if (String(path).endsWith("/decide")) malformed = true;
    return Response.json(malformed ? { ...state, proposals: null } : state);
  });
  const { view, cleanup } = mount();
  try {
    await waitFor(() =>
      expect(view.getByRole("button", { name: "Accept local training move" })).toBeEnabled()
    );
    fireEvent.click(view.getByRole("button", { name: "Accept local training move" }));
    await waitFor(() =>
      expect(view.queryByRole("article", { name: "Local training" }) === null).toBe(true)
    );
    expect(
      view
        .getAllByRole("alert")
        .some((alert) => alert.textContent?.includes("could not be verified"))
    ).toBe(true);
    expect(view.queryByRole("button", { name: "Accept local training move" })).toBeNull();
    expect(view.queryByText(/Decision saved/)).toBeNull();
  } finally {
    cleanup();
    fetch.mockRestore();
  }
});

test("changed inputs disable stale decisions and recalculation selects a current proposal", async () => {
  const state = scenario();
  const stale = { ...proposal(), inputVersion: "old-inputs" };
  state.proposals = [stale];
  const fetch = spyOn(globalThis, "fetch").mockImplementation(async (path) => {
    if (String(path).endsWith("/propose")) {
      state.version++;
      // Even if an old pending record comes last, prefer the proposal for current inputs.
      state.proposals = [
        { ...proposal(), id: "current-proposal", actor: "current coordinator" },
        stale,
      ];
    }
    return Response.json(structuredClone(state));
  });
  const { view, cleanup } = mount();
  try {
    await waitFor(() => expect(view.getByText(/Planning inputs changed/)).toBeTruthy());
    expect(view.getByRole("button", { name: "Accept local training move" })).toBeDisabled();
    expect(view.getByRole("button", { name: "Reject proposal" })).toBeDisabled();
    expect(view.getByRole("button", { name: "Calculate and save proposal" })).toBeEnabled();
    fireEvent.click(view.getByRole("button", { name: "Calculate and save proposal" }));
    await waitFor(() =>
      expect(view.getByRole("button", { name: "Accept local training move" })).toBeEnabled()
    );
    expect(view.getByRole("button", { name: "Reject proposal" })).toBeEnabled();
    expect(
      within(view.getByLabelText("Saved proposal")).getByText(/Calculated by current coordinator/)
    ).toBeTruthy();
    expect(view.getByText(/Stale proposal:.*old-inputs/)).toBeTruthy();
    expect(view.queryByText(/Planning inputs changed/)).toBeNull();
  } finally {
    cleanup();
    fetch.mockRestore();
  }
});
