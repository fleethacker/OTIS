import "../route-registry";
import { expect, spyOn, test } from "bun:test";
import { useState } from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AccountProfileProvider } from "./AccountProfileProvider";
import { useSession, isAccountSession, type AccountSession } from "./session";
import { testSession } from "../test-utils/render";
import { beginSessionAccess } from "./session-access";
import { SettingsProvider } from "./SettingsProvider";
import { useSettings } from "./settings-data";

const response = (value: unknown) => new Response(JSON.stringify(value));
const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

test("profile metadata accepts native roles and IANA zones, rejecting malformed login data", () => {
  expect(
    isAccountSession({
      ...testSession,
      settings: { ...testSession.settings, timezone: "America/New_York" },
    })
  ).toBe(true);
  for (const login of [
    true,
    { startedAt: "invalid", previousLoginAt: null, briefingAvailable: true },
  ]) {
    expect(isAccountSession({ ...testSession, login })).toBe(false);
  }
  expect(
    isAccountSession({ ...testSession, user: { ...testSession.user, role: "platform_admin" } })
  ).toBe(false);
  expect(
    isAccountSession({ ...testSession, settings: { ...testSession.settings, timezone: "invalid" } })
  ).toBe(false);
});

test("profile requests wait behind the native session gate and never renew it", async () => {
  const access = beginSessionAccess();
  access.accept("same-account", Date.now() / 1000 - 1);
  const requests: string[] = [];
  const fetch = spyOn(globalThis, "fetch").mockImplementation(async (path) => {
    requests.push(String(path));
    return response(testSession);
  });
  const cache = client();
  const view = render(
    <QueryClientProvider client={cache}>
      <AccountProfileProvider>
        <p>Watch workspace</p>
      </AccountProfileProvider>
    </QueryClientProvider>
  );
  try {
    await act(async () => {
      await Promise.resolve();
    });
    expect(requests).toEqual([]);
    expect(view.queryByText("Watch workspace")).toBeNull();
    await act(async () => {
      access.accept("same-account", null);
    });
    await waitFor(() => expect(view.getByText("Watch workspace")).toBeTruthy());
    expect(requests).toEqual(["/api/v1/auth/session"]);
  } finally {
    view.unmount();
    cache.clear();
    access.release();
    fetch.mockRestore();
  }
});

test("changed station assignment removes stale local workspace state", async () => {
  const station = {
    shipName: "USS America",
    commandIds: ["AMERICA"],
    department: "Engineering",
    watchStation: "Engineering watch",
    responsibilityIds: ["engineering"],
    includeUnassigned: false,
    revision: 1,
    source: "admin" as const,
  };
  let current: AccountSession = {
    ...testSession,
    user: { ...testSession.user!, stationAssignment: station },
  };
  const fetch = spyOn(globalThis, "fetch").mockImplementation(async () => response(current));
  function Workspace() {
    const [value, setValue] = useState("");
    const { refresh } = useSession();
    return (
      <>
        <input
          aria-label="Local workspace state"
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
        <button onClick={() => void refresh()}>Refresh profile</button>
      </>
    );
  }
  const cache = client();
  const view = render(
    <QueryClientProvider client={cache}>
      <AccountProfileProvider>
        <Workspace />
      </AccountProfileProvider>
    </QueryClientProvider>
  );
  try {
    await waitFor(() => expect(view.getByLabelText("Local workspace state")).toBeTruthy());
    fireEvent.change(view.getByLabelText("Local workspace state"), {
      target: { value: "Prior station data" },
    });
    current = {
      ...current,
      user: {
        ...current.user!,
        stationAssignment: { ...station, revision: 2, commandIds: ["NEW"] },
      },
    };
    fireEvent.click(view.getByText("Refresh profile"));
    await waitFor(() => expect(view.getByLabelText("Local workspace state")).toHaveValue(""));
  } finally {
    view.unmount();
    cache.clear();
    fetch.mockRestore();
  }
});

test("account preferences and native settings share one timezone value", async () => {
  let timezone = "UTC";
  const fetch = spyOn(globalThis, "fetch").mockImplementation(async (path, init) => {
    if (String(path).endsWith("/settings/get"))
      return response({ revision: "1", settings: { defaultTimezone: "UTC" } });
    if (String(path).endsWith("/settings/preferences")) return response({ timezone });
    if (String(path).endsWith("/account/settings")) {
      timezone = JSON.parse(String(init?.body)).timezone;
      return response({ ...testSession.settings, timezone });
    }
    return response(testSession);
  });
  function Workspace() {
    const { session, saveSettings } = useSession();
    const settings = useSettings();
    return (
      <>
        <output aria-label="Shared timezone">
          {settings.timezone}:{session?.settings.timezone}
        </output>
        <button
          onClick={() => void saveSettings({ ...session!.settings, timezone: "America/New_York" })}
        >
          Save timezone
        </button>
      </>
    );
  }
  const cache = client();
  const view = render(
    <QueryClientProvider client={cache}>
      <SettingsProvider>
        <AccountProfileProvider>
          <Workspace />
        </AccountProfileProvider>
      </SettingsProvider>
    </QueryClientProvider>
  );
  try {
    await waitFor(() =>
      expect(view.getByLabelText("Shared timezone")).toHaveTextContent("UTC:UTC")
    );
    fireEvent.click(view.getByText("Save timezone"));
    await waitFor(() =>
      expect(view.getByLabelText("Shared timezone")).toHaveTextContent(
        "America/New_York:America/New_York"
      )
    );
    await act(async () => {
      cache.setQueryData(["settings", "preferences"], { timezone: "Europe/London" });
    });
    await waitFor(() =>
      expect(view.getByLabelText("Shared timezone")).toHaveTextContent(
        "Europe/London:Europe/London"
      )
    );
  } finally {
    view.unmount();
    cache.clear();
    fetch.mockRestore();
  }
});

test("invalid profile fails closed with a retry", async () => {
  let value: unknown = { ...testSession, login: true };
  const fetch = spyOn(globalThis, "fetch").mockImplementation(async () => response(value));
  const cache = client();
  const view = render(
    <QueryClientProvider client={cache}>
      <AccountProfileProvider>
        <p>Private workspace</p>
      </AccountProfileProvider>
    </QueryClientProvider>
  );
  try {
    await waitFor(() => expect(view.getByRole("alert")).toHaveTextContent("could not be verified"));
    expect(view.queryByText("Private workspace")).toBeNull();
    value = testSession;
    fireEvent.click(view.getByText("Retry account profile"));
    await waitFor(() => expect(view.getByText("Private workspace")).toBeTruthy());
  } finally {
    view.unmount();
    cache.clear();
    fetch.mockRestore();
  }
});

test("same-account login on window focus refreshes its checkpoint and discards prior view state", async () => {
  let current = testSession;
  const fetch = spyOn(globalThis, "fetch").mockImplementation(async () => response(current));
  function Workspace() {
    const { session } = useSession();
    const [value, setValue] = useState("");
    return (
      <>
        <output aria-label="Login checkpoint">{session?.login?.startedAt}</output>
        <input
          aria-label="Briefing view state"
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
      </>
    );
  }
  const cache = client();
  const view = render(
    <QueryClientProvider client={cache}>
      <AccountProfileProvider>
        <Workspace />
      </AccountProfileProvider>
    </QueryClientProvider>
  );
  try {
    await waitFor(() =>
      expect(view.getByLabelText("Login checkpoint")).toHaveTextContent("2026-11-05T10:00:00Z")
    );
    fireEvent.change(view.getByLabelText("Briefing view state"), {
      target: { value: "Old checkpoint" },
    });
    current = {
      ...testSession,
      login: { ...testSession.login!, startedAt: "2026-11-05T11:00:00Z" },
    };
    fireEvent(window, new Event("focus"));
    await waitFor(() =>
      expect(view.getByLabelText("Login checkpoint")).toHaveTextContent("2026-11-05T11:00:00Z")
    );
    expect(view.getByLabelText("Briefing view state")).toHaveValue("");
  } finally {
    view.unmount();
    cache.clear();
    fetch.mockRestore();
  }
});

test("revoked profile offers native sign-in without showing the workspace", async () => {
  const fetch = spyOn(globalThis, "fetch").mockImplementation(
    async () =>
      new Response(JSON.stringify({ message: "Sign in again after your access changed." }), {
        status: 401,
      })
  );
  const cache = client();
  const view = render(
    <QueryClientProvider client={cache}>
      <AccountProfileProvider>
        <p>Private workspace</p>
      </AccountProfileProvider>
    </QueryClientProvider>
  );
  try {
    await waitFor(() =>
      expect(view.getByRole("link", { name: "Sign in again" })).toHaveAttribute(
        "href",
        `/auth/login?return=${encodeURIComponent(window.location.pathname + window.location.search)}`
      )
    );
    expect(view.queryByText("Private workspace")).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  } finally {
    view.unmount();
    cache.clear();
    fetch.mockRestore();
  }
});
