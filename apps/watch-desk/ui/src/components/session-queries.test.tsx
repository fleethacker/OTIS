import { expect, spyOn, test } from "bun:test";
import { act, fireEvent, waitFor } from "@testing-library/react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { renderWithProviders } from "../test-utils/render";
import { AuthGate } from "./AuthGate";
import { SessionQueryProvider } from "./session-queries";
import { useSource } from "./source-data";

for (const change of ["different owner", "same owner with narrower scope"]) {
  test(`native session ${change} cannot reuse cached source or evidence while new data loads`, async () => {
    let generation = 0;
    let resolveNewSource: ((response: Response) => void) | undefined;
    const clients: QueryClient[] = [];
    const fetch = spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input) === "/auth/session") {
        return Response.json({
          userId: generation === 0 || change.startsWith("same") ? "owner-a" : "owner-b",
          identity: { username: "Same display name", role: "viewer" },
          scope: (generation === 0 ? "a" : "b").repeat(64),
          mode: "local_demo",
          expiresAt: null,
          sessionExpiresAt: null,
        });
      }
      if (String(input) === "/api/v1/messages/search") {
        if (generation === 0) {
          return Response.json({
            messages: [{ sourceMessageId: "old-source", subject: "Prior-scope source evidence" }],
            meta: {},
          });
        }
        return new Promise<Response>((resolve) => {
          resolveNewSource = resolve;
        });
      }
      throw new Error(`Unexpected request ${String(input)}`);
    });
    function SourceContent() {
      const client = useQueryClient();
      if (!clients.includes(client)) clients.push(client);
      const source = useSource("search", {});
      return (
        <div>
          {source.data?.messages.map((message) => (
            <p key={message.sourceMessageId}>{message.subject}</p>
          ))}
          {source.isPending && <p>New scope loading</p>}
        </div>
      );
    }
    const view = renderWithProviders(
      <AuthGate>
        <SessionQueryProvider>
          <SourceContent />
        </SessionQueryProvider>
      </AuthGate>
    );
    try {
      await view.findByText("Prior-scope source evidence");
      expect(clients).toHaveLength(1);
      expect(clients[0].getQueryCache().getAll().length).toBeGreaterThan(0);
      generation = 1;
      fireEvent(window, new Event("focus"));
      await waitFor(() => expect(resolveNewSource).toBeDefined());
      expect(clients).toHaveLength(2);
      expect(clients[0].getQueryCache().getAll()).toHaveLength(0);
      expect(view.queryByText("Prior-scope source evidence")).toBeNull();
      expect(view.getByText("New scope loading")).toBeTruthy();
      await act(async () =>
        resolveNewSource?.(
          Response.json({
            messages: [{ sourceMessageId: "new-source", subject: "Current permitted source" }],
            meta: {},
          })
        )
      );
      await view.findByText("Current permitted source");
      expect(view.queryByText("Prior-scope source evidence")).toBeNull();
      view.unmount();
      expect(clients[1].getQueryCache().getAll()).toHaveLength(0);
    } finally {
      view.unmount();
      fetch.mockRestore();
    }
  });
}
