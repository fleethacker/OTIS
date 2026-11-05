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

test("MOVEREP cards show source set names and edition-specific field labels", () => {
  const set = (set_id: string, values: string[]) => ({
    set_id, fields: values.map((value, index) => ({ position: index + 1, value })), rows: [],
  });
  const view = renderWithProviders(<StructuredMessage message={create(MessageRecordSchema, {
    structuredPayloadJson: JSON.stringify({ source_profile: "observed-moverep-b10112-v1", sets: [
      set("MSGID", ["MOVEREP", "MIL-STD-6040(SERIES)", "B.1.01.12", "CTF42", "013", "20090714T132530Z", "-", "-", "USA", "UNCLASSIFIED"]),
      set("REF", ["A", "OPGEN", "-", "CTF40", "061230ZJAN1991", "001", "PASEP", "BPA", "IAA"]),
      set("AMPN", ["REF A IS THE AUTHORIZING DOCUMENT"]),
      set("MARACT", ["INTEND", "ANCHOR", "230925ZJUL", "NAME:NORFOLK"]),
      set("TASKORG", ["TF40", "-", "GALATEA", "DANAE", "DEWEY"]),
      set("FYPOS", ["TUD:CTG12.02", "3510N07901W", "141325Z", "270T12KTS", "USA"]),
      set("ROUTE", ["071435Z", "5534N01230E", "RH", "071441Z", "NAME:POINT ALFA"]),
      set("SOA", ["12", "15"]),
      set("EPREQ", ["OTSR", "230925ZJUL", "251000ZJUL"]),
      set("LIMITS", ["15FT", "22FT", "4M", "40"]),
      set("POST", ["LIVERPOOL", "02JUN", "08JUN"]),
      set("BDCT", ["121200Z", "BCS:A2MX", "171800Z", "BCS:S4CZ", "180001Z", "123"]),
      set("BDCTNUM", ["H11A-001", "H15AA-999"]),
      set("COMMS", ["UD:TU12.02.02", "QUICK SEARCH", "2468KHZ", "P", "SSB", "275.6MHZ", "S", "NESTOR"]),
      set("LQDSTAT", ["AJAX", "230925ZJUL", "F54", "80", "10"]),
      set("SHORNAV", ["122330Z", "OBSTRUCTION LIGHTS", "130600Z"]),
      set("METEO", ["230", "5KTS", "3", "1"]),
    ] }),
  })} />);
  expect(view.getByRole("heading", { name: "MARACT - MARITIME ACTIVITY" })).toBeTruthy();
  expect(view.getByRole("heading", { name: "TASKORG - TASK ORGANIZATION" })).toBeTruthy();
  expect(view.getByRole("heading", { name: "ROUTE" })).toBeTruthy();
  expect(view.getByText("MOVEREP activity action")).toBeTruthy();
  expect(view.getAllByText("Unit name")).toHaveLength(2);
  expect(view.getByText("Friendly force position")).toBeTruthy();
  expect(view.getAllByText("Route point")).toHaveLength(2);
  expect(view.getByText("Issue date-time")).toBeTruthy();
  expect(view.getByText("Classification")).toBeTruthy();
  expect(view.getByText("Reference originator")).toBeTruthy();
  expect(view.getByText("Reference date-time")).toBeTruthy();
  expect(view.getByText("Special notation")).toBeTruthy();
  expect(view.getAllByText("SIC code")).toHaveLength(2);
  expect(view.getByText("Free text")).toBeTruthy();
  expect(view.getByRole("heading", { name: "SOA - SPEED OF ADVANCE" })).toBeTruthy();
  expect(view.getByText("Surface speed in knots")).toBeTruthy();
  expect(view.getByRole("heading", { name: "EPREQ - ENVIRONMENTAL PRODUCT REQUEST" })).toBeTruthy();
  expect(view.getByText("Environmental prediction system product")).toBeTruthy();
  expect(view.getByText("True windspeed in knots")).toBeTruthy();
  expect(view.getByText("Last broadcast number received")).toBeTruthy();
  expect(view.getAllByText("Specific radio frequency or channel")).toHaveLength(2);
  expect(view.getByText("Percentage of total capacity held")).toBeTruthy();
  expect(view.getByText("Name of navigation light")).toBeTruthy();
  expect(view.getByText("Cloud cover in eighths")).toBeTruthy();
  expect(view.getByText("Flag")).toBeTruthy();
  expect(view.container.textContent).not.toMatch(/Field \d+/);
});
