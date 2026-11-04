import { test, expect, setSystemTime } from "bun:test";
import { waitFor } from "@testing-library/react";
import { renderWithProviders } from "../test-utils/render";
import { DisplayTimeProvider, TIME_MODE_KEY } from "./display-time";
import { HeaderClock } from "./header-clock";

test("header clock uses the shared UTC zone and refreshes from actual clock time", async () => {
  setSystemTime(new Date("2026-11-04T12:34:56Z"));
  localStorage.setItem(TIME_MODE_KEY, "local");
  try {
    const view = renderWithProviders(
      <DisplayTimeProvider>
        <HeaderClock />
      </DisplayTimeProvider>
    );
    const clock = view.getByRole("timer", { name: "Current time" });
    expect(clock.textContent).toBe("12:34:56 UTC");
    expect(clock.getAttribute("aria-live")).toBe("off");
    setSystemTime(new Date("2026-11-04T12:35:02Z"));
    await waitFor(() => expect(clock.textContent).toBe("12:35:02 UTC"), { timeout: 2000 });
    expect(clock.getAttribute("datetime")).toBe("2026-11-04T12:35:02.000Z");
    view.unmount();
  } finally {
    setSystemTime();
    localStorage.removeItem(TIME_MODE_KEY);
  }
});
