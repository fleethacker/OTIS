import { test, expect, spyOn, setSystemTime, jest } from "bun:test";
import { useState } from "react";
import { act, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../test-utils/render";
import { AuthGate } from "./AuthGate";
import { Modal } from "./modal";
test("authentication gate never shows private content on network errors", async () => {
  const fetch = spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
  const view = renderWithProviders(
    <AuthGate>
      <p>Private messages</p>
    </AuthGate>
  );
  try {
    await waitFor(() => expect(view.getByRole("alert").textContent).toBe("Sign-in unavailable."));
    expect(view.queryByText("Private messages")).toBeNull();
  } finally {
    view.unmount();
    fetch.mockRestore();
  }
});
test("authentication gate accepts only a current server session", async () => {
  const fetch = spyOn(globalThis, "fetch").mockImplementation(
    async () =>
      new Response(
        JSON.stringify({
          scope: "a".repeat(64),
          mode: "oidc",
          expiresAt: Math.floor(Date.now() / 1000) + 120,
          sessionExpiresAt: Math.floor(Date.now() / 1000) + 900,
        })
      )
  );
  const view = renderWithProviders(
    <AuthGate>
      <p>Private messages</p>
    </AuthGate>
  );
  try {
    await waitFor(() => expect(view.getByText("Private messages")).toBeTruthy());
  } finally {
    view.unmount();
    fetch.mockRestore();
  }
});

test("account changes on focus remount private state", async () => {
  let scope = "a".repeat(64);
  const fetch = spyOn(globalThis, "fetch").mockImplementation(
    async () =>
      new Response(
        JSON.stringify({
          scope,
          mode: "oidc",
          expiresAt: Math.floor(Date.now() / 1000) + 120,
          sessionExpiresAt: Math.floor(Date.now() / 1000) + 900,
        })
      )
  );
  function PrivateDraft() {
    const [draft, setDraft] = useState("");
    return (
      <input
        aria-label="Private draft"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
    );
  }
  const view = renderWithProviders(
    <AuthGate>
      <PrivateDraft />
    </AuthGate>
  );
  try {
    const draft = await view.findByLabelText("Private draft");
    fireEvent.change(draft, { target: { value: "First user's draft" } });
    scope = "b".repeat(64);
    fireEvent(window, new Event("focus"));
    await waitFor(() =>
      expect((view.getByLabelText("Private draft") as HTMLInputElement).value).toBe("")
    );
  } finally {
    view.unmount();
    fetch.mockRestore();
  }
});

test("portalled drafts hide during revalidation and resume only for the same account", async () => {
  const response = (scope: string) =>
    new Response(
      JSON.stringify({
        scope: scope.repeat(64),
        mode: "oidc",
        expiresAt: Math.floor(Date.now() / 1000) + 120,
        sessionExpiresAt: Math.floor(Date.now() / 1000) + 900,
      })
    );
  let initial = true;
  let resolveCheck: ((value: Response) => void) | undefined;
  const fetch = spyOn(globalThis, "fetch").mockImplementation(async () => {
    if (initial) {
      initial = false;
      return response("a");
    }
    return new Promise<Response>((resolve) => {
      resolveCheck = resolve;
    });
  });
  function PrivateDialog() {
    const [draft, setDraft] = useState("");
    return (
      <Modal title="Private draft" onClose={() => {}}>
        <input
          aria-label="Draft text"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
      </Modal>
    );
  }
  const view = renderWithProviders(
    <AuthGate>
      <PrivateDialog />
    </AuthGate>
  );
  try {
    await view.findByRole("dialog", { name: "Private draft" });
    fireEvent.change(view.getByLabelText("Draft text"), {
      target: { value: "First user's draft" },
    });
    fireEvent(window, new Event("focus"));
    expect(view.queryByRole("dialog")).toBeNull();
    expect(view.getByRole("status").textContent).toBe("Signing in…");
    await act(async () => resolveCheck?.(response("a")));
    await view.findByRole("dialog", { name: "Private draft" });
    expect((view.getByLabelText("Draft text") as HTMLInputElement).value).toBe(
      "First user's draft"
    );
    fireEvent(window, new Event("focus"));
    expect(view.queryByRole("dialog")).toBeNull();
    await act(async () => resolveCheck?.(response("b")));
    await view.findByRole("dialog", { name: "Private draft" });
    expect((view.getByLabelText("Draft text") as HTMLInputElement).value).toBe("");
  } finally {
    view.unmount();
    fetch.mockRestore();
  }
});

test("access-token expiry does not sign out an idle user before the IdP session deadline", async () => {
  const start = new Date("2026-11-05T15:00:00Z");
  jest.useFakeTimers();
  setSystemTime(start);
  const fetch = spyOn(globalThis, "fetch").mockImplementation(
    async () =>
      new Response(
        JSON.stringify({
          scope: "a".repeat(64),
          mode: "oidc",
          expiresAt: start.getTime() / 1000 + 60,
          sessionExpiresAt: start.getTime() / 1000 + 900,
        })
      )
  );
  const view = renderWithProviders(
    <AuthGate>
      <p>Private messages</p>
    </AuthGate>
  );
  try {
    await view.findByText("Private messages");
    await act(async () => {
      jest.advanceTimersByTime(61000);
    });
    expect(view.getByText("Private messages")).toBeTruthy();
    expect(fetch).toHaveBeenCalledTimes(1);
    await act(async () => {
      jest.advanceTimersByTime(839000);
    });
    expect(view.queryByText("Private messages")).toBeNull();
    expect(view.getByRole("link", { name: "Sign in" })).toBeTruthy();
    expect(fetch).toHaveBeenCalledTimes(1);
  } finally {
    view.unmount();
    fetch.mockRestore();
    jest.useRealTimers();
    setSystemTime();
  }
});

test("scrolling renews an expired access token without losing the current view", async () => {
  const start = new Date("2026-11-05T15:00:00Z");
  setSystemTime(start);
  const fetch = spyOn(globalThis, "fetch").mockImplementation(
    async () =>
      new Response(
        JSON.stringify({
          scope: "a".repeat(64),
          mode: "oidc",
          expiresAt: Date.now() / 1000 + 60,
          sessionExpiresAt: Date.now() / 1000 + 900,
        })
      )
  );
  function PrivateDraft() {
    const [draft, setDraft] = useState("");
    return (
      <input
        aria-label="Private draft"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
    );
  }
  const view = renderWithProviders(
    <AuthGate>
      <PrivateDraft />
    </AuthGate>
  );
  try {
    const draft = await view.findByLabelText("Private draft");
    fireEvent.change(draft, { target: { value: "Keep this draft" } });
    setSystemTime(new Date(start.getTime() + 61000));
    fireEvent.wheel(document);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(fetch.mock.calls[1]?.[0]).toBe("/auth/refresh");
    expect(fetch.mock.calls[1]?.[1]?.method).toBe("POST");
    expect((view.getByLabelText("Private draft") as HTMLInputElement).value).toBe(
      "Keep this draft"
    );
  } finally {
    view.unmount();
    fetch.mockRestore();
    setSystemTime();
  }
});
