import { test, expect, spyOn } from "bun:test";
import { beginSessionAccess, sessionFetch } from "./session-access";

test("idle polling waits without a request or refresh, then resumes for the same user", async () => {
  const access = beginSessionAccess();
  access.accept("viewer", Date.now() / 1000 - 1);
  const fetch = spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
  try {
    const response = sessionFetch("/api/v1/notifications/list");
    await Promise.resolve();
    expect(fetch).not.toHaveBeenCalled();
    access.accept("viewer", Date.now() / 1000 + 60);
    expect((await response).ok).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[0]).toBe("/api/v1/notifications/list");
  } finally {
    access.release();
    fetch.mockRestore();
  }
});

test("a pending action never runs under a changed account or role", async () => {
  const access = beginSessionAccess();
  access.accept("first-owner", Date.now() / 1000 - 1);
  const fetch = spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
  try {
    const response = sessionFetch("/api/v1/settings/save-preferences", { method: "POST" });
    access.accept("second-owner", Date.now() / 1000 + 60);
    await expect(response).rejects.toThrow("Session changed");
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    access.release();
    fetch.mockRestore();
  }
});

test("session expiry and cancellation discard queued requests", async () => {
  const access = beginSessionAccess();
  access.accept("viewer", Date.now() / 1000 - 1);
  const fetch = spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
  try {
    const abort = new AbortController();
    const canceled = sessionFetch("/api/v1/messages/search", { signal: abort.signal });
    abort.abort();
    await expect(canceled).rejects.toThrow("Request aborted");
    const expired = sessionFetch("/api/v1/notifications/list");
    access.deny();
    await expect(expired).rejects.toThrow("Session unavailable");
    access.accept("viewer", Date.now() / 1000 + 60);
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    access.release();
    fetch.mockRestore();
  }
});

test("a late response from an old page cannot unlock the new page's requests", async () => {
  const old = beginSessionAccess();
  old.accept("viewer", Date.now() / 1000 - 1);
  const current = beginSessionAccess();
  const fetch = spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
  try {
    old.accept("viewer", Date.now() / 1000 + 60);
    await expect(sessionFetch("/api/v1/messages/search")).rejects.toThrow("Session unavailable");
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    current.release();
    fetch.mockRestore();
  }
});
