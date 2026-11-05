import { expect, spyOn, test } from "bun:test";
import { fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderWithProviders, testSession } from "../test-utils/render";
import { SessionContext, type AccountSession } from "./session";
import { useSource } from "./source-data";

function Results() {
  const result = useSource("timeline", {});
  return (
    <>
      <button onClick={() => void result.refetch()}>Refresh source</button>
      <output aria-label="Source records">
        {result.data?.messages.map((message) => message.subject).join(", ") ?? "Unavailable"}
      </output>
      {result.isError && <p role="alert">{result.error.message}</p>}
    </>
  );
}
test("scope changes discard previous results; denied refresh hides data while transient failures retain it", async () => {
  let mode: "old" | "new" | "unavailable" | "permission_denied" = "old";
  const fetch = spyOn(globalThis, "fetch").mockImplementation(async () =>
    mode === "old" || mode === "new"
      ? new Response(
          JSON.stringify({
            messages: [
              {
                sourceMessageId: mode,
                subject: mode === "old" ? "Old command traffic" : "New command traffic",
              },
            ],
          })
        )
      : new Response(JSON.stringify({ code: mode, message: mode }), {
          status: mode === "unavailable" ? 503 : 403,
        })
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const content = (session: AccountSession) => (
    <SessionContext.Provider
      value={{
        session,
        refresh: async () => {},
        saveSettings: async () => {},
        logout: async () => {},
      }}
    >
      <QueryClientProvider client={client}>
        <Results />
      </QueryClientProvider>
    </SessionContext.Provider>
  );
  const view = renderWithProviders(content(testSession));
  try {
    await waitFor(() =>
      expect(view.getByLabelText("Source records").textContent).toBe("Old command traffic")
    );
    mode = "new";
    view.rerender(
      content({
        ...testSession,
        settings: {
          ...testSession.settings,
          messageScope: { allCommands: false, commandIds: ["NEW"], includeUnassigned: false },
        },
      })
    );
    expect(view.getByLabelText("Source records").textContent).not.toContain("Old command traffic");
    await waitFor(() =>
      expect(view.getByLabelText("Source records").textContent).toBe("New command traffic")
    );
    mode = "unavailable";
    fireEvent.click(view.getByRole("button", { name: "Refresh source" }));
    await waitFor(() => expect(view.getByRole("alert").textContent).toBe("unavailable"));
    expect(view.getByLabelText("Source records").textContent).toBe("New command traffic");
    mode = "permission_denied";
    fireEvent.click(view.getByRole("button", { name: "Refresh source" }));
    await waitFor(() => expect(view.getByRole("alert").textContent).toBe("permission_denied"));
    expect(view.getByLabelText("Source records").textContent).toBe("Unavailable");
  } finally {
    view.unmount();
    client.clear();
    fetch.mockRestore();
  }
});
