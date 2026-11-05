import "../route-registry";
import { expect, spyOn, test } from "bun:test";
import { act, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderWithProviders, testSession } from "../test-utils/render";
import { SessionContext } from "../components/session";
import Calendar from "./calendar";

const snapshot = (title: string) => ({
  messages: [{ id: "1", sourceMessageId: "morning@r1" }],
  meta: {
    timelineItems: [
      {
        key: "morning-event",
        messageKey: "morning@r1",
        kind: "interval",
        title,
        start: "2026-11-04T08:00:00Z",
        end: "2026-11-04T09:00:00Z",
        reviewRequired: false,
      },
    ],
  },
});

test("manual refresh keeps events visible while pending and after failure, then displays new data", async () => {
  let reads = 0;
  let release: ((value: Response) => void) | undefined;
  const fetch = spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    if (String(input).endsWith("/commands/list")) {
      return new Response(
        JSON.stringify({
          commands: [],
          source: "test",
          version: "test",
          provenance: "fictional",
          assignmentEnabled: false,
        })
      );
    }
    reads++;
    if (reads === 2)
      return new Promise<Response>((resolve) => {
        release = resolve;
      });
    return new Response(JSON.stringify(snapshot(reads === 1 ? "Morning watch" : "Updated watch")));
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = renderWithProviders(
    <QueryClientProvider client={client}>
      <Calendar />
    </QueryClientProvider>,
    { route: "/calendar?date=2026-11-04" }
  );
  try {
    await waitFor(() =>
      expect(view.getByRole("link", { name: "Morning watch, source record" })).toBeTruthy()
    );
    const refresh = view.getByRole("button", { name: "Refresh calendar" });
    expect(refresh.title).toContain("Last refreshed:");
    const refreshed = refresh.title;
    fireEvent.click(view.getByRole("button", { name: "Refresh calendar" }));
    await waitFor(() => expect(release).toBeDefined());
    expect(view.getByRole("link", { name: "Morning watch, source record" })).toBeTruthy();
    await act(async () => {
      release?.(new Response(JSON.stringify({ message: "Source unavailable" }), { status: 503 }));
    });
    await waitFor(() =>
      expect(view.getByRole("alert").textContent).toContain("Showing saved schedule")
    );
    expect(view.getByRole("link", { name: "Morning watch, source record" })).toBeTruthy();
    expect(refresh.title).toBe(refreshed);
    fireEvent.click(view.getByRole("button", { name: "Retry" }));
    await waitFor(() =>
      expect(view.getByRole("link", { name: "Updated watch, source record" })).toBeTruthy()
    );
    expect(view.queryByRole("link", { name: "Morning watch, source record" })).toBeNull();
  } finally {
    view.unmount();
    client.clear();
    fetch.mockRestore();
  }
});

test("saved default view applies only when the calendar link has no explicit view", () => {
  const session = {
    ...testSession,
    settings: {
      ...testSession.settings,
      defaultCalendarView: "week" as const,
      calendarRefreshSeconds: 0 as const,
    },
  };
  const content = (
    <SessionContext.Provider
      value={{
        session,
        refresh: async () => {},
        saveSettings: async () => {},
        logout: async () => {},
      }}
    >
      <Calendar />
    </SessionContext.Provider>
  );
  const view = renderWithProviders(content, { route: "/calendar?date=2026-11-04" });
  expect(view.getByRole("button", { name: "Week", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  view.unmount();
  const explicit = renderWithProviders(content, { route: "/calendar?date=2026-11-04&view=day" });
  expect(explicit.getByRole("button", { name: "Day", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
});
