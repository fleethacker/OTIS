import { expect, test } from "bun:test";
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { renderWithProviders } from "../test-utils/render";
import { MessageRecordSchema } from "../gen/app/v1/models_pb";
import { MessageLifecycle } from "./message-lifecycle";
test("lifecycle anchors issue first, orders actual ingestion/failure timestamps and leaves send pending", () => {
  const at = (value: string) => timestampFromDate(new Date(value));
  const view = renderWithProviders(
    <MessageLifecycle
      message={create(MessageRecordSchema, {
        lifecycleEntries: [
          { id: "parsed", milestone: "parsed", recordedAt: at("2026-11-04T12:00:03Z") },
          { id: "issued", milestone: "issued", recordedAt: at("2008-04-01T12:00:00Z") },
          {
            id: "failed",
            milestone: "ingest_failed",
            recordedAt: at("2026-11-04T12:00:02Z"),
            detail: "Publication failed",
          },
          { id: "ingested", milestone: "ingested", recordedAt: at("2026-11-04T12:00:01Z") },
        ],
      })}
    />
  );
  expect(
    view.getAllByRole("listitem").map((item) => item.querySelector("strong")?.textContent)
  ).toEqual(["Issued", "Ingested", "Ingestion failed", "Parsed", "Acknowledgement sent"]);
  expect(view.getByText("Pending")).toBeTruthy();
  expect(view.getByText("2026-11-04 12:00:02Z").closest("li")?.getAttribute("data-failed")).toBe(
    "true"
  );
  expect(view.getAllByRole("listitem").at(-1)?.querySelector("time")).toBeNull();
});
test("an actual send event displays its timestamp instead of pending; missing data never gets current time", () => {
  const view = renderWithProviders(
    <MessageLifecycle
      message={create(MessageRecordSchema, {
        lifecycleEntries: [
          {
            id: "sent",
            milestone: "acknowledgement_sent",
            recordedAt: timestampFromDate(new Date("2026-11-04T13:00:00Z")),
          },
        ],
      })}
    />
  );
  expect(view.queryByText("Pending")).toBeNull();
  expect(view.getByText("2026-11-04 13:00:00Z")).toBeTruthy();
  expect(view.getAllByText("Time unavailable")).toHaveLength(2);
  expect(view.container.querySelectorAll("time")).toHaveLength(1);
});
