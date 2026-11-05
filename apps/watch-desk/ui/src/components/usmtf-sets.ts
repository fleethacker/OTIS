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
const moverepNames: Record<string, string> = {
  AMPN: "AMPLIFICATION",
  AREA: "AREA",
  BDCT: "BROADCAST WATCH",
  BDCTNUM: "BROADCAST NUMBER",
  COMMS: "COMMUNICATIONS",
  EPREQ: "ENVIRONMENTAL PRODUCT REQUEST",
  FYPOS: "FRIENDLY FORCES POSITION",
  LIMITS: "ENVIRONMENTAL LIMITS",
  LQDSTAT: "SHIPBOARD LIQUIDS STATUS",
  MARACT: "MARITIME ACTIVITY",
  METEO: "METEOROLOGICAL INFORMATION (ABBREVIATED)",
  POST: "MAIL (POST) DELIVERY",
  REF: "REFERENCE",
  SAIL: "SAILING INFORMATION",
  SHORNAV: "SHORE NAVIGATIONAL LIGHTS AND BEACONS",
  SOA: "SPEED OF ADVANCE",
  TASKORG: "TASK ORGANIZATION",
  ROUTE: "ROUTE",
};
const moverepFixedFields: Record<string, readonly (string | undefined)[]> = {
  AMPN: ["Free text"],
  FYPOS: ["Unit designation", "Friendly force position", "Position day-time", "Course and speed", "Flag", "Discrete identifier code"],
  SAIL: ["Arrival time", "Sailing location", "Departure time"],
  SOA: ["Surface speed in knots", "Dive speed in knots"],
  EPREQ: ["Environmental prediction system product", "Start month date-time", "Stop month date-time"],
  LIMITS: ["Head seas", "Abeam seas", "Following seas", "True windspeed in knots"],
  POST: ["Delivery place name", "First day-month of delivery", "Last day-month of delivery"],
  BDCTNUM: ["Last broadcast number received", "First broadcast number received"],
  LQDSTAT: ["Unit", "Verified effective month date-time", "Fuel or water type", "Percentage of total capacity held", "Percentage consumed daily"],
  SHORNAV: ["Activation day-time", "Name of navigation light", "Termination day-time"],
  METEO: ["Wind direction in degrees", "Wind speed in knots", "Sea state", "Cloud cover in eighths"],
  CANX: ["Cancelled message type", "Cancelled originator", "Cancelled reference time", "Cancelled serial", "Special notation"],
};
const moverepMappedSets = new Set([
  ...Object.keys(moverepFixedFields),
  "MSGID", "MARACT", "TASKORG", "ROUTE", "AREA", "REF", "BDCT", "COMMS",
]);
function isMoverep(
  profile: string | undefined
): profile is "usmtf-2003-moverep-v1" | "observed-moverep-b10112-v1" {
  return profile === "usmtf-2003-moverep-v1" || profile === "observed-moverep-b10112-v1";
}
function moverepFieldLabel(
  set: string,
  position: number,
  value: string,
  profile: string
): string | undefined {
  const observed = profile === "observed-moverep-b10112-v1";
  if (set === "MSGID") {
    const labels = observed
      ? ["Message text format identifier", "Format standard", "Format revision", "Originator", "Message serial", "Issue date-time", undefined, undefined, "Security policy", "Classification", "Release to"]
      : ["Message text format identifier", "Originator", "Message serial"];
    return labels[position - 1];
  }
  if (set === "MARACT") {
    return ["MOVEREP activity action", "MOVEREP activity type", observed ? "Effective month date-time" : "Verified effective month date-time",
      value.startsWith("NAME:") || value.startsWith("PLACE:") ? "Place name" : "Position or point",
      "Operational control authority", "Operational command", "Tactical control authority", "Primary mission designator"][position - 1];
  }
  if (set === "TASKORG") {
    return position >= 4
      ? "Unit name"
      : ["Task organization designator", "Task organization commander", "Unit commander embarked"][position - 1];
  }
  if (set === "ROUTE") {
    return ["Time at route point", "Route point", "Method of route movement"][(position - 1) % 3];
  }
  if (set === "AREA") {
    return "Area vertex or position";
  }
  if (set === "REF") {
    const base = observed
      ? ["Reference letter", "Referenced message type", undefined, "Reference originator", "Reference date-time", "Reference serial"]
      : ["Reference letter", "Referenced message type", "Reference originator", "Reference date-time", "Reference serial"];
    if (position <= base.length) {
      return base[position - 1];
    }
    if (position === base.length + 1) {
      return "Special notation";
    }
    return /^[A-Z]{3}$/.test(value) ? "SIC code" : "Filing number";
  }
  if (set === "BDCT") {
    if (position % 2 === 1) {
      return position === 1 ? "Set watch day-time" : "Shift watch day-time";
    }
    if (value.startsWith("BCS:")) {
      return "Broadcast call sign";
    }
    if (/^\d{3}$/.test(value)) {
      return "Naval/Amphibious communications net line number";
    }
    return "Broadcast designator";
  }
  if (set === "COMMS") {
    if (position === 1) {
      return value.startsWith("UD:") ? "Specific unit designator" : "Unit";
    }
    if (position === 2) {
      return "Specific call sign";
    }
    return ["Specific radio frequency or channel", "Communication priority", "Transmission mode"][(position - 3) % 3];
  }
  return moverepFixedFields[set]?.[position - 1];
}
export function setFullName(set: string, profile?: string) {
  if (isMoverep(profile) && Object.prototype.hasOwnProperty.call(moverepNames, set)) {
    return moverepNames[set];
  }
  return setCatalog[set]?.name;
}
export function setFieldLabel(
  set: string,
  position: number,
  examples: boolean | undefined,
  value = "",
  profile?: string
): string | undefined {
  if (isMoverep(profile) && moverepMappedSets.has(set)) {
    return moverepFieldLabel(set, position, value, profile) ?? (value === "-" ? "Omitted field" : undefined);
  }
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
