import { expect, test } from "bun:test";
import {
  blankPreparation,
  formatPreparation,
  responses,
  validDTG,
  validatePreparation,
} from "./preparation-format";

// Paired with samplePreparation/TestPreparationFormatter in the Go service tests.
export const synthetic = {
  ...blankPreparation,
  outgoing: "USS EXAMPLE",
  letter: "A",
  type: "OPTASK LINK",
  originator: "CTF DEMO",
  dtg: "041200ZNOV2026",
  authority: "USS EXAMPLE",
  family: "ACTAGCY",
  response: "WILCO",
  confirmed: true,
};
test("synthetic 2003 reference vector and exclusive families", () => {
  expect(formatPreparation(synthetic)).toBe(
    "MSGID/AKNLDG/USS EXAMPLE//\nREF/A/OPTASK LINK/CTF DEMO/041200ZNOV2026//\nACTAGCY/USS EXAMPLE/WILCO/A//"
  );
  for (const [family, codes] of Object.entries(responses))
    for (const response of Object.keys(codes)) {
      const text = formatPreparation({
        ...synthetic,
        family,
        response,
        contextKind: "EXER",
        context: "DEMO",
        serial: "123",
      });
      expect(text.startsWith("EXER/DEMO//\nMSGID/")).toBe(true);
      expect(text.endsWith(`${family}/USS EXAMPLE/${response}/A//`)).toBe(true);
      expect(text).toContain("ZNOV2026/123//");
    }
});
test("strict calendar DTGs and no fabricated precision", () => {
  for (const dtg of ["291200ZFEB2024", "010000ZJAN0001", "312359ZDEC9999"])
    expect(validDTG(dtg)).toBe(true);
  for (const dtg of [
    "291200ZFEB2025",
    "311200ZAPR2026",
    "012400ZJAN2026",
    "011260ZJAN2026",
    "041200ZNOV26",
    "041200ANOV2026",
    "041200Znov2026",
    "001200ZNOV2026",
    "041200ZNOV0000",
  ])
    expect(validDTG(dtg)).toBe(false);
});
test("validation retains incomplete work but rejects unsafe bounds and generation", () => {
  expect(validatePreparation(blankPreparation, false)).toEqual({});
  expect(Object.keys(validatePreparation(blankPreparation)).length).toBeGreaterThan(0);
  for (const edit of [
    { outgoing: "" },
    { confirmed: false },
    { response: "HAVECO" },
    { family: "ICVALID" },
    { letter: "a" },
    { type: "X" },
    { contextKind: "OPER" },
    { context: "unlinked" },
    { contextKind: "BOTH", context: "context" },
    { authority: "UNIT//ACTAGCY" },
    { notes: "hidden\nset" },
    { serial: "12345678901" },
  ])
    expect(Object.keys(validatePreparation({ ...synthetic, ...edit })).length).toBeGreaterThan(0);
});
