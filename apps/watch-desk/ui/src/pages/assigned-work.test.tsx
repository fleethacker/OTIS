import { expect, spyOn, test } from "bun:test";
import { act, fireEvent, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "../test-utils/render-workflow";
import AssignedWork from "./assigned-work";
import type { WorkList, WorkTask } from "../components/work-data";
function task(id = "original"): WorkTask {
  return {
    id,
    logicalEventId: id,
    version: 1,
    eventVersion: 1,
    source: { messageKey: `sha256:${"a".repeat(64)}@priority-1-demo-v1`, factId: "a1" },
    action: `Review ${id}`,
    commandId: "demo-meridian",
    responsibilityId: "ops",
    responsibilityName: "OPS",
    ownerId: "test-user",
    ownerName: "Local owner",
    personId: "P-01",
    ruleId: "demo-v1",
    assignmentReason: "Explicit Meridian OPS rule",
    dueAt: "2026-11-10T09:00:00Z",
    dueBasis: "Local demo policy",
    start: "2026-11-10T09:00:00Z",
    end: "2026-11-10T09:45:00Z",
    sourceExcerpt: "COMPLAN/MERIDIAN COMMS/A/100900ZNOV2026/100945ZNOV2026//",
    sourceContacts: [{ name: "External POC" }],
    sourceStatus: "partial",
    factStatus: "unvalidated",
    reviewFlags: ["unprojected_sets"],
    progress: "not_started",
    reviews: [],
    history: [],
    canAct: true,
    reviewed: false,
    overdue: true,
  };
}
function setup(
  options: { coordinate?: boolean; stale?: boolean; denied?: boolean; malformed?: boolean } = {}
) {
  const original = task();
  if (options.denied) original.canAct = false;
  const data: WorkList = {
    configured: true,
    canCoordinate: options.coordinate ?? false,
    scenarioId: "meridian",
    scenarioNow: "2026-11-10T09:01:00Z",
    version: 1,
    pendingSources: [],
    items: [
      original,
      { ...task("unknown"), dueAt: null, overdue: false },
      {
        ...task("unassigned"),
        ownerId: null,
        ownerName: null,
        canAct: options.coordinate ?? false,
        overdue: false,
      },
    ],
  };
  const requests: Array<{ operation: string; body: Record<string, unknown> }> = [];
  const mock = spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    const operation = String(url).split("/").pop()!;
    if (operation === "list") return Response.json(options.malformed ? { items: null } : data);
    const body = JSON.parse(String(init?.body));
    requests.push({ operation, body });
    const selected = data.items.find((item) => item.id === body.taskId)!;
    if (options.stale) {
      selected.version += 1;
      return Response.json(
        { message: "Task version changed; reload before deciding" },
        { status: 409 }
      );
    }
    if (operation === "review") {
      selected.reviews.push({
        actor: "test-user",
        responsibilityId: "ops",
        source: selected.source,
        eventVersion: selected.eventVersion,
        recordedAt: "2026-11-05T12:00:00Z",
      });
      selected.reviewed = true;
      selected.overdue = false;
    } else if (operation === "progress") selected.progress = body.progress;
    else if (operation === "assign") {
      selected.ownerId = body.ownerId;
      selected.ownerName = body.ownerId ? "Demo coordinator" : null;
    }
    selected.version += 1;
    return Response.json({ item: selected });
  });
  const view = renderWithProviders(<AssignedWork />);
  return {
    view,
    data,
    requests,
    close: () => {
      view.unmount();
      mock.mockRestore();
    },
  };
}
test("queue shows exact evidence, unknown/unassigned/overdue states and filters", async () => {
  const { view, close } = setup();
  try {
    await waitFor(() =>
      expect(view.getByRole("article", { name: "Review original" })).toBeTruthy()
    );
    expect(view.getByText("Due time unknown")).toBeTruthy();
    expect(view.getByText(/OPS · Unassigned/)).toBeTruthy();
    const card = within(view.getByRole("article", { name: "Review original" }));
    expect(card.getByText("Overdue review")).toBeTruthy();
    expect(card.getByRole("link", { name: /Open exact source/ }).getAttribute("href")).toContain(
      "record=sha256%3A"
    );
    fireEvent.change(view.getByLabelText("Show work"), { target: { value: "unknown" } });
    expect(view.queryByRole("article", { name: "Review original" })).toBeNull();
    expect(view.getByRole("article", { name: "Review unknown" })).toBeTruthy();
  } finally {
    close();
  }
});
test("review updates rendered version status without completing work", async () => {
  const { view, requests, close } = setup();
  try {
    await waitFor(() =>
      expect(view.getByRole("article", { name: "Review original" })).toBeTruthy()
    );
    const card = within(view.getByRole("article", { name: "Review original" }));
    await act(async () => {
      fireEvent.click(card.getByRole("button", { name: "Reviewed this version" }));
    });
    await waitFor(() => expect(card.getByText("Version reviewed")).toBeTruthy());
    expect(card.getByText("Not started", { selector: "span" })).toBeTruthy();
    expect(card.getByRole("button", { name: "Reviewed this version" })).toBeDisabled();
    expect(requests[0].body).toEqual({ taskId: "original", expectedVersion: 1, eventVersion: 1 });
    expect(requests.every((request) => !request.operation.includes("acknowledge"))).toBe(true);
  } finally {
    close();
  }
});
test("reassignment persists visible owner and stale errors survive a refresh", async () => {
  const setupA = setup({ coordinate: true });
  try {
    await waitFor(() =>
      expect(setupA.view.getByRole("article", { name: "Review original" })).toBeTruthy()
    );
    const card = within(setupA.view.getByRole("article", { name: "Review original" }));
    fireEvent.change(card.getByLabelText("Decision reason"), {
      target: { value: "Relief coordination" },
    });
    fireEvent.change(card.getByLabelText("Local owner"), { target: { value: "demo:dev-admin" } });
    await act(async () => {
      fireEvent.click(card.getByRole("button", { name: "Reassign" }));
    });
    await waitFor(() => expect(card.getByText(/OPS · Demo coordinator/)).toBeTruthy());
    expect(setupA.requests[0].body.ownerId).toBe("demo:dev-admin");
  } finally {
    setupA.close();
  }
  const setupB = setup({ stale: true });
  try {
    await waitFor(() =>
      expect(setupB.view.getByRole("article", { name: "Review original" })).toBeTruthy()
    );
    const card = within(setupB.view.getByRole("article", { name: "Review original" }));
    await act(async () => {
      fireEvent.click(card.getByRole("button", { name: "Reviewed this version" }));
    });
    await waitFor(() =>
      expect(card.getByRole("alert").textContent).toContain("Task version changed")
    );
    expect(card.getByText("Review required")).toBeTruthy();
  } finally {
    setupB.close();
  }
});
test("read-only tasks and malformed service responses fail visibly", async () => {
  const setupA = setup({ denied: true });
  try {
    await waitFor(() =>
      expect(setupA.view.getByRole("article", { name: "Review original" })).toBeTruthy()
    );
    const card = within(setupA.view.getByRole("article", { name: "Review original" }));
    expect(card.getByRole("button", { name: "Reviewed this version" })).toBeDisabled();
    expect(card.queryByRole("button", { name: "Save progress" })).toBeNull();
  } finally {
    setupA.close();
  }
  const setupB = setup({ malformed: true });
  try {
    await waitFor(() =>
      expect(setupB.view.getByRole("alert").textContent).toContain("invalid work data")
    );
  } finally {
    setupB.close();
  }
});
