export const blankPreparation = {
  outgoing: "",
  letter: "",
  type: "",
  originator: "",
  dtg: "",
  serial: "",
  authority: "",
  family: "",
  response: "",
  contextKind: "",
  context: "",
  notes: "",
  confirmed: false,
};
export type PreparationFields = typeof blankPreparation;
export const responses: Record<string, Record<string, string>> = {
  ACTAGCY: {
    ACK: "Acknowledge: understanding, not compliance",
    WILCO: "Will comply: intent to comply",
    HAVCO: "Have complied: compliance completed",
    CANTCO: "Cannot comply",
  },
  ICVALID: { NONVAL: "Nonvalidated", VALID: "Validated", VALCHG: "Validated with change" },
};
export function validDTG(value: string) {
  const match =
    /^(\d{2})(\d{2})(\d{2})Z(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\d{4})$/.exec(value);
  if (!match) {
    return false;
  }
  const [, d, h, m, mon, y] = match;
  const month = "JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC".split(" ").indexOf(mon);
  const date = new Date(0);
  date.setUTCFullYear(Number(y), month, Number(d));
  return (
    Number(y) > 0 &&
    Number(h) < 24 &&
    Number(m) < 60 &&
    date.getUTCMonth() === month &&
    date.getUTCDate() === Number(d)
  );
}
export function validatePreparation(f: PreparationFields, generate = true) {
  const errors: Partial<Record<keyof PreparationFields, string>> = {};
  const limits = {
    outgoing: 30,
    letter: 1,
    type: 20,
    originator: 30,
    dtg: 14,
    serial: 10,
    authority: 50,
    family: 7,
    response: 6,
    contextKind: 4,
    context: 100,
    notes: 2000,
  };
  for (const key of Object.keys(limits) as (keyof typeof limits)[]) {
    if ([...f[key]].length > limits[key]) {
      errors[key] = `Maximum ${limits[key]} characters.`;
    }
    if (/[/\\\p{Cc}\p{Cf}\u2028\u2029]/u.test(f[key])) {
      errors[key] = "Remove delimiters and control characters.";
    }
    if (
      generate &&
      [
        "outgoing",
        "letter",
        "type",
        "originator",
        "dtg",
        "authority",
        "family",
        "response",
      ].includes(key) &&
      !f[key].trim()
    ) {
      errors[key] = "Required for generation; enter verified information.";
    }
  }
  if (generate) {
    if (!/^[A-Z]$/.test(f.letter)) {
      errors.letter = "Use one uppercase reference letter A-Z.";
    }
    if (f.type.length < 2) {
      errors.type = "Use 2-20 characters for the reference type.";
    }
    if (!validDTG(f.dtg)) {
      errors.dtg = "Use a real Zulu date DDHHMMZMONYYYY, with four-digit year.";
    }
    if (!responses[f.family]?.[f.response]) {
      errors.response = "Select a response in the chosen family.";
    }
    if (!f.confirmed) {
      errors.confirmed = "Confirm understanding and authority before generation.";
    }
    if (
      (f.contextKind === "") !== (f.context === "") ||
      !["", "EXER", "OPER"].includes(f.contextKind)
    ) {
      errors.context = "Choose EXER or OPER with one context, or leave both empty.";
    }
  }
  return errors;
}
export function formatPreparation(f: PreparationFields) {
  if (Object.keys(validatePreparation(f)).length > 0) {
    throw new Error("Invalid preparation");
  }
  return [
    f.contextKind && `${f.contextKind}/${f.context}//`,
    `MSGID/AKNLDG/${f.outgoing}//`,
    `REF/${f.letter}/${f.type}/${f.originator}/${f.dtg}${f.serial ? `/${f.serial}` : ""}//`,
    `${f.family}/${f.authority}/${f.response}/${f.letter}//`,
  ]
    .filter(Boolean)
    .join("\n");
}
