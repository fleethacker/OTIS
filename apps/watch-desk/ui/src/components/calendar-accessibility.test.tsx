import { create } from "@bufbuild/protobuf";
import { MessageRecordSchema } from "../gen/app/v1/models_pb";
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

test("canonical point events render in the calendar without a fabricated duration or confirmation", () => {
  const message = create(MessageRecordSchema, { sourceMessageId: "source@r1" });
  const result = renderWithProviders(
    <DayTimeline
      messages={[message]}
      sourceItems={[
        {
          key: "source@r1#point",
          messageKey: "source@r1",
          factId: "point",
          title: "Source check",
          kind: "point",
          at: "2026-11-04T10:00:00Z",
          reviewRequired: true,
        },
      ]}
      from={Date.UTC(2026, 10, 4)}
      to={Date.UTC(2026, 10, 5)}
      interval={60}
      returnTo="/calendar"
    />
  );
  expect(result.getByRole("link", { name: "Source check, source record" })).toBeTruthy();
  expect(result.getByText("Point: 2026-11-04 10:00 UTC")).toBeTruthy();
  expect(result.getByText(/Requires review/)).toBeTruthy();
  expect(result.container.querySelectorAll(".calendar-point").length).toBe(1);
});
