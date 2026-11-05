import { expect, test } from "bun:test";
import { create } from "@bufbuild/protobuf";
import { MessageRecordSchema } from "../gen/app/v1/models_pb";
import { renderWithProviders } from "../test-utils/render";
import { StructuredMessage } from "./structured-message";
import { setCatalog } from "./usmtf-catalog";
import { setFieldLabel } from "./usmtf-sets";

test("set cards show handbook names and repeated acknowledgement recipients", () => {
  const set = (set_id: string, values: string[]) => ({
    set_id,
    fields: values.map((value, index) => ({ position: index + 1, value })),
    rows: [],
  });
  const view = renderWithProviders(
    <StructuredMessage
      message={create(MessageRecordSchema, {
        structuredPayloadJson: JSON.stringify({
          source_profile: "observed-optask-extensions-v1",
          sets: [
            set("CONTAMIN", ["EXERCISE PLATFORM", "YES"]),
            set("PROOF", ["EXERCISE PLATFORM", "YES"]),
            set("AKNLDG", ["YES", "EXERCISE ONE", "EXERCISE TWO", "INST:REPORT RECEIPT"]),
            set("AEWEMPL", ["UNVERIFIED ORIGINAL VALUE"]),
          ],
        }),
      })}
    />
  );
  expect(
    view.getByRole("heading", { name: "CONTAMIN - CONTAMINATION ACCEPTABILITY" })
  ).toBeTruthy();
  expect(view.getByRole("heading", { name: "PROOF - PROOF OF SUCCESS REQUIREMENT" })).toBeTruthy();
  expect(view.getByText("Contamination indicator")).toBeTruthy();
  expect(view.getByText("Proof of success indicator")).toBeTruthy();
  expect(view.getAllByText("Force or unit required to acknowledge")).toHaveLength(2);
  expect(view.getByText("Instructions for acknowledging")).toBeTruthy();
  expect(view.getByText("UNVERIFIED ORIGINAL VALUE")).toBeTruthy();
  expect(view.container.textContent).not.toMatch(/\bField \d+\b/);
});

test("all catalog and unknown fields avoid numbered placeholders and edition shifts", () => {
  for (const set of [...Object.keys(setCatalog), "AEWEMPL", "FORCEMAR", "UNKNOWN"]) {
    for (const edition of [true, false, undefined]) {
      for (let position = 1; position < 80; position++) {
        expect(setFieldLabel(set, position, edition, "SOURCE") ?? "").not.toMatch(/^Field \d+$/);
      }
    }
  }
  expect(setFieldLabel("MSGID", 4, true)).toBe("Originator");
  expect(setFieldLabel("MSGID", 4, false)).toBe("Month name");
  expect(setFieldLabel("AUTOCAT", 4, true)).toBeUndefined();
  expect(setFieldLabel("NUCRLSE", 5, true)).toBe("Time duration in minutes and seconds");
  expect(setFieldLabel("CONTAMIN", 4, true)).toBe("Contamination indicator");
  expect(setFieldLabel("AKNLDG", 3, true, "EXERCISE TWO")).toBe(
    "Force or unit required to acknowledge"
  );
});

test("handbook field names include table definitions and one-letter descriptors", () => {
  expect(setFieldLabel("CVYORG", 2, false, "EXERCISE SHIP")).toBe("Commodore's ship name");
  expect(setFieldLabel("CVYORG", 4, false, "EXERCISE SHIP")).toBe("Vice commodore's ship name");
  expect(setFieldLabel("JUDATA", 14, false, "AB")).toBe("NATO track number root");
  expect(setFieldLabel("MCMPLAN", 8, false, "10")).toBe("Platform turn time in minutes");
  expect(setFieldLabel("THRPRI", 1, false, "EXERCISE")).toBe("Enemy weapon");
  expect(setFieldLabel("THRPRI", 3, false, "EXERCISE")).toBe("Enemy weapon");
  expect(setFieldLabel("CIRC", 1, false, "N:EXERCISE AREA")).toBe("Place name");
  expect(setFieldLabel("RASKED", 2, false, "N:EXERCISE AREA")).toBe(
    "Rendezvous position, place name"
  );
  expect(setFieldLabel("MCMPLAN", 12, false, "M:100")).toBe("Plan navigation error, meters");
  expect(setFieldLabel("POC", 5, true, "TEL:555-0100")).toBe("Nonsecure telephone number");
  expect(setFieldLabel("POC", 6, true, "EMAIL:watch@example.invalid")).toBe(
    "Electronic mail address"
  );
  expect(setFieldLabel("POC", 7, true, "UNVERIFIED:SOURCE")).toBeUndefined();
});
