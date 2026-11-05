import { expect, test } from "bun:test";
import { create } from "@bufbuild/protobuf";
import { MessageRecordSchema } from "../gen/app/v1/models_pb";
import { renderWithProviders } from "../test-utils/render";
import { StructuredMessage } from "./structured-message";

test("CASREP reader identifies estimated dates and source conflict without inventing tasking", () => {
  const view = renderWithProviders(
    <StructuredMessage
      message={create(MessageRecordSchema, {
        structuredPayloadJson: JSON.stringify({
          type: "CASREP",
          source_profile: "observed-casrep-b10112-v1",
          casualty: {
            report_type: "INITIAL",
            serial: "2026001",
            reporting_uic: "N54321",
            equipment: "TEST RADAR",
            eic: "AB12",
            category: "2",
            cause: "1",
            repair_estimate_date: "1995-06-25",
          },
          review_flags: ["casualty_time_conflict"],
          sets: [{ set_id: "CASLTY", fields: [{ position: 4, value: "TEST RADAR" }], rows: [] }],
        }),
      })}
    />
  );
  expect(view.getByRole("region", { name: "Casualty summary" })).toBeTruthy();
  expect(view.getByText("Estimated repair date")).toBeTruthy();
  expect(view.getByText("1995-06-25")).toBeTruthy();
  expect(view.getByText(/Estimated date only/)).toBeTruthy();
  expect(view.getByRole("status").textContent).toContain("Source dates conflict");
  expect(view.getByRole("heading", { name: "CASLTY - CASUALTY REPORT" })).toBeTruthy();
});

test("CANCEL is visible as report withdrawal and GENADMIN has no casualty summary", () => {
  const message = (type: string) =>
    create(MessageRecordSchema, {
      structuredPayloadJson: JSON.stringify({
        type,
        casualty: { report_type: "CANCEL", serial: "2026001" },
      }),
    });
  const view = renderWithProviders(<StructuredMessage message={message("CASREP")} />);
  expect(view.getByText(/Repair completion is not implied/)).toBeTruthy();
  view.unmount();
  const other = renderWithProviders(<StructuredMessage message={message("GENADMIN")} />);
  expect(other.queryByRole("region", { name: "Casualty summary" })).toBeNull();
});

test("reader shows unresolved source report history alongside the selected report", () => {
  const view = renderWithProviders(
    <StructuredMessage
      message={create(MessageRecordSchema, {
        structuredPayloadJson: JSON.stringify({
          type: "CASREP",
          casualty: { report_type: "UPDATE", serial: "2026001" },
          casualty_history: {
            state: "unresolved",
            history: [
              { report_type: "UPDATE", update_sequence: "02", issued_at: "2026-11-06T12:00:00Z" },
            ],
          },
        }),
      })}
    />
  );
  expect(view.getByRole("region", { name: "Reported casualty history" })).toBeTruthy();
  expect(view.getByText("History requires review")).toBeTruthy();
  expect(view.getByText(/UPDATE 02/)).toBeTruthy();
  expect(view.getByText(/Reports are missing or conflict/)).toBeTruthy();
});
