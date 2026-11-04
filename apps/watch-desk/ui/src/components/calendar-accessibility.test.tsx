import { expect, test } from "bun:test";
import { renderWithProviders } from "../test-utils/render";
import { DayTimeline } from "./day-timeline";
import { waitFor } from "@testing-library/react";

for (const view of ["day", "week", "month"] as const) {
  test(`empty ${view} calendar mounts without invalid table layout semantics`, async () => {
    const result = renderWithProviders(
      <DayTimeline
        messages={[]}
        from={Date.UTC(2026, 10, 4)}
        to={Date.UTC(2026, 10, 5)}
        interval={60}
        returnTo="/calendar"
        view={view}
      />
    );
    expect(result.getByRole("region", { name: "Zulu UTC calendar, scrollable" })).toBeTruthy();
    await waitFor(() =>
      expect(
        result.container.querySelectorAll(
          '[role="row"], [role="rowgroup"], [role="cell"], [role="columnheader"]'
        ).length
      ).toBe(0)
    );
  });
}
