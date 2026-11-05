import { expect, test } from "bun:test";
import { fireEvent, waitFor } from "@testing-library/react";
import { Link, useLocation } from "react-router-dom";
import { renderWithProviders, testSession } from "../test-utils/render";
import { SessionContext, isAccountSession, type AccountSession } from "./session";
import { ShiftLanding } from "./shift-landing";

function Location() {
  const location = useLocation();
  return (
    <>
      <output aria-label="Workspace location">
        {location.pathname + location.search + location.hash}
      </output>
      <Link to="/calendar?view=week">Continue to calendar</Link>
    </>
  );
}
function content(session: AccountSession) {
  return (
    <SessionContext.Provider
      value={{
        session,
        refresh: async () => {},
        saveSettings: async () => {},
        logout: async () => {},
      }}
    >
      <ShiftLanding />
      <Location />
    </SessionContext.Provider>
  );
}
test("new UDS bootstrap opens briefing once and preserves the safe requested workspace", async () => {
  const fresh: AccountSession = { ...testSession, authMode: "uds_sso", openBriefing: true };
  const requested = "/messages?record=sha256%3Aexample%40r1#source";
  const view = renderWithProviders(content(fresh), { route: requested });
  try {
    await waitFor(() =>
      expect(view.getByLabelText("Workspace location").textContent).toBe(
        `/shift?${new URLSearchParams({ returnTo: requested })}`
      )
    );
    fireEvent.click(view.getByRole("link", { name: "Continue to calendar" }));
    expect(view.getByLabelText("Workspace location").textContent).toBe("/calendar?view=week");
    // The original response may remain in context until the next session check.
    view.rerender(content({ ...fresh }));
    expect(view.getByLabelText("Workspace location").textContent).toBe("/calendar?view=week");
    view.rerender(content({ ...fresh, openBriefing: false }));
    expect(view.getByLabelText("Workspace location").textContent).toBe("/calendar?view=week");
  } finally {
    view.unmount();
  }
});
test("ordinary checks stay put and a later new session opens its own briefing", async () => {
  const session: AccountSession = { ...testSession, authMode: "uds_sso", openBriefing: false };
  const view = renderWithProviders(content(session), { route: "/account" });
  try {
    expect(view.getByLabelText("Workspace location").textContent).toBe("/account");
    view.rerender(
      content({
        ...session,
        openBriefing: true,
        login: { ...session.login!, startedAt: "2026-11-06T10:00:00Z" },
      })
    );
    await waitFor(() =>
      expect(view.getByLabelText("Workspace location").textContent).toBe(
        "/shift?returnTo=%2Faccount"
      )
    );
  } finally {
    view.unmount();
  }
});
test("root and action destinations continue safely to Calendar; existing shift location stays intact", () => {
  const fresh: AccountSession = { ...testSession, authMode: "uds_sso", openBriefing: true };
  for (const route of ["/", "/api/v1/auth/logout"]) {
    const view = renderWithProviders(content(fresh), { route });
    expect(view.getByLabelText("Workspace location").textContent).toBe(
      "/shift?returnTo=%2Fcalendar"
    );
    view.unmount();
  }
  const view = renderWithProviders(content(fresh), { route: "/shift?returnTo=%2Fmessages" });
  expect(view.getByLabelText("Workspace location").textContent).toBe("/shift?returnTo=%2Fmessages");
  fireEvent.click(view.getByRole("link", { name: "Continue to calendar" }));
  expect(view.getByLabelText("Workspace location").textContent).toBe("/calendar?view=week");
  view.unmount();
});
test("session validation rejects a malformed briefing handoff flag", () => {
  expect(isAccountSession({ ...testSession, openBriefing: "true" })).toBe(false);
  expect(isAccountSession({ ...testSession, openBriefing: true })).toBe(true);
});
