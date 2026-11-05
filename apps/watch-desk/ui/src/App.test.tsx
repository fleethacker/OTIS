import "./route-registry";
import { expect, spyOn, test } from "bun:test";
import { render } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { App } from "./App";
import { SessionContext } from "./components/session";
import { testSession } from "./test-utils/render";

test("each authenticated App mount owns a fresh cache and clears private values on unmount", () => {
  const clients: QueryClient[] = [];
  const originalMount = QueryClient.prototype.mount;
  const mount = spyOn(QueryClient.prototype, "mount").mockImplementation(function (
    this: QueryClient
  ) {
    clients.push(this);
    originalMount.call(this);
  });
  const fetch = spyOn(globalThis, "fetch").mockImplementation(
    async () => new Response(JSON.stringify({ messages: [], meta: {} }))
  );
  const content = (
    <SessionContext.Provider
      value={{
        session: testSession,
        refresh: async () => {},
        saveSettings: async () => {},
        logout: async () => {},
      }}
    >
      <App />
    </SessionContext.Provider>
  );
  const first = render(content);
  try {
    const firstClient = clients[0]!;
    firstClient.setQueryData(["private-account-data"], "First account's cached draft");
    first.unmount();
    expect(firstClient.getQueryData(["private-account-data"])).toBeUndefined();
    expect(firstClient.getQueryCache().getAll()).toHaveLength(0);
    const second = render(content);
    try {
      expect(clients.at(-1)).not.toBe(firstClient);
      expect(clients.at(-1)?.getQueryData(["private-account-data"])).toBeUndefined();
    } finally {
      second.unmount();
    }
  } finally {
    first.unmount();
    mount.mockRestore();
    fetch.mockRestore();
  }
});
