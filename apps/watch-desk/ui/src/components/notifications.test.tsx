import "../route-registry";
import { expect, test } from "bun:test";
import { fireEvent } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { renderWithProviders } from "../test-utils/render";
import {
  ExtractedEventSchema,
  EventRevisionSchema,
  MessageRecordSchema,
} from "../gen/app/v1/models_pb";
import { NotificationPanel } from "./notifications";
import { notifications, readNotificationState, saveNotificationState } from "./notification-data";

test("notification panel mounts and opens a truthful reminder with providers", () => {
  const view = renderWithProviders(<NotificationPanel identity="render-test" />);
  fireEvent.click(view.getByRole("button", { name: "Notifications", exact: true }));
  expect(view.getByRole("heading", { name: "Notifications" })).toBeTruthy();
  expect(view.getByRole("link", { name: "Review today's UTC schedule" })).toBeTruthy();
});
test("deduplicated source items track revisions, not order or receipt time", () => {
  const e = create(ExtractedEventSchema, { id: 1n, title: "Watch", isRevised: true });
  const m = create(MessageRecordSchema, {
    sourceMessageId: "A",
    provenance: "fictional",
    processingStatus: "needs_review",
    events: [e],
  });
  const before = notifications([m, m], "2026-11-04");
  expect(before.length).toBe(2);
  expect(before[1].fictional).toBe(true);
  expect(before[1].context).toContain("Revised");
  expect(before[1].context).toContain("Needs review");
  expect(notifications([m], "2026-11-04")[1].key).toBe(before[1].key);
  e.revisions.push(create(EventRevisionSchema, { sequence: 2n, description: "New revision" }));
  expect(notifications([m], "2026-11-04")[1].key).not.toBe(before[1].key);
  expect(notifications([], "2026-11-05")[0].key).not.toBe(before[0].key);
  expect(notifications([], "2026-11-05").length).toBe(1);
});
test("read state is identity-local and malformed data is safe", () => {
  expect(saveNotificationState("one", ["daily:today"])).toBe(true);
  expect(readNotificationState("one").keys).toEqual(["daily:today"]);
  expect(readNotificationState("two").keys).toEqual([]);
  localStorage.setItem("watch-desk:notifications:v1:bad", "not json");
  expect(readNotificationState("bad")).toEqual({ keys: [], failed: true });
});
