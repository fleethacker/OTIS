import { setCatalog } from "./usmtf-catalog";
import { isObject, type Fields, type Value } from "./structured-message-format";

export interface SetField {
  position: number;
  value: string;
}
export interface SourceSet {
  set_id: string;
  fields: SetField[];
  rows: { fields: SetField[] }[];
}
function fieldList(value: Value | undefined): SetField[] | undefined {
  if (!Array.isArray(value)) {
    return;
  }
  const fields: SetField[] = [];
  for (const field of value) {
    if (
      !isObject(field) ||
      typeof field.position !== "number" ||
      !Number.isInteger(field.position) ||
      field.position < 1 ||
      typeof field.value !== "string"
    ) {
      return;
    }
    fields.push({ position: field.position, value: field.value });
  }
  return fields;
}
export function sourceSets(payload: Fields | undefined): SourceSet[] | undefined {
  if (!payload || !Array.isArray(payload.sets)) {
    return;
  }
  const sets: SourceSet[] = [];
  for (const value of payload.sets) {
    if (
      !isObject(value) ||
      typeof value.set_id !== "string" ||
      !/^[A-Z0-9]{3,8}$/.test(value.set_id)
    ) {
      return;
    }
    const fields = fieldList(value.fields);
    if (!fields || !Array.isArray(value.rows)) {
      return;
    }
    const rows: { fields: SetField[] }[] = [];
    for (const row of value.rows) {
      if (!isObject(row)) {
        return;
      }
      const fields = fieldList(row.fields);
      if (!fields) {
        return;
      }
      rows.push({ fields });
    }
    sets.push({ set_id: value.set_id, fields, rows });
  }
  return sets;
}

// The observed examples insert/reorder fields in these baseline sets. Keep
// their verified positions separate; an absent mapping leaves the source value bare.
const observedPositions: Record<string, (number | undefined)[] | undefined> = {
  MSGID: [1, undefined, undefined, 2, 3, undefined, 5, 6],
  REF: [1, 2, undefined, 3, 4, 5, 6, 7],
  CRYPTDAT: [3, 4, 5],
  IVCCN: [1, 3, undefined, 2],
  DALKFREQ: [1, 2, 3, undefined, 4, 5, 6],
  AUTOCAT: [1, 3, 4, undefined, undefined, 5],
  COMMS: [1, 2],
};
export function setFullName(set: string) {
  return setCatalog[set]?.name;
}
export function setFieldLabel(
  set: string,
  position: number,
  examples: boolean | undefined,
  value = ""
): string | undefined {
  if (examples === undefined) {
    return;
  }
  const definition = setCatalog[set];
  if (definition === undefined) {
    return;
  }
  const remap = examples ? observedPositions[set] : undefined;
  let selected = remap ? remap[position - 1] : position;
  if (selected === undefined) {
    return;
  }
  const last = Math.max(...Object.keys(definition.fields).map(Number));
  if (selected > last && definition.repeatFrom !== undefined) {
    selected =
      definition.repeatFrom +
      ((selected - definition.repeatFrom) % (last - definition.repeatFrom + 1));
  }
  const alternatives = definition.fields[selected];
  if (alternatives === undefined || alternatives.length === 0) {
    return;
  }
  const prefix = /^([A-Z][A-Z0-9]*):/.exec(value)?.[1];
  const matched =
    prefix !== undefined ? alternatives.filter((field) => field.prefix === prefix) : [];
  if (matched.length === 1) {
    return matched[0].name;
  }
  const plain = alternatives.filter((field) => field.prefix === undefined);
  if (matched.length === 0 && plain.length === 1 && prefix === undefined) {
    return plain[0].name;
  }
  if (alternatives.length === 1) {
    return alternatives[0].name;
  }
  // A field can have several format alternatives. Do not claim an unverified
  // alternative merely because it appears first in the handbook.
  return;
}
