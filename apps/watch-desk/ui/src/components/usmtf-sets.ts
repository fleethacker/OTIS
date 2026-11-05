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

// Field labels follow the 2003 set catalog. Observed extension layouts are selected
// separately: their offsets must never inherit incompatible baseline definitions.
const baseline: Record<string, string[] | undefined> = {
  MSGID: ["Message type", "Originator", "Serial", "Month", "Qualifier", "Qualifier serial"],
  PERIOD: ["Start", "End / qualifier", "Qualified time"],
  POC: ["Name", "Rank / position", "Unit", "Location"],
  EXER: ["Exercise", "Additional identifier"],
  OPER: ["Operation", "Plan", "Option", "Secondary option"],
  REF: [
    "Reference",
    "Message / communication type",
    "Originator",
    "Date / time",
    "Serial",
    "Notation",
  ],
  HEADING: ["Heading"],
  GEODATUM: ["Datum"],
  CIRC: ["Center", "Radius"],
  RNDZVOUS: ["Rendezvous", "Position", "Unit being joined", "Joining unit", "Altitude"],
  FYPOS: ["Unit", "Position", "Time", "Course / speed"],
  PIM: ["Position", "Time", "Course / speed", "Duration"],
  DIVERT: ["Position", "Course"],
  ANCHOR: ["Unit", "Start", "End", "Position"],
  DLRPGRID: ["Point type", "Designator", "Position", "Effective time"],
  LNKISCC: ["Position", "Coordinate center"],
  MDA: ["Area", "Position", "Mine index"],
  CHANDAT: [
    "Point / position designator",
    "Start position",
    "End position",
    "Direction",
    "Length",
    "Width",
    "Tidal course / speed",
    "Start",
    "End",
    "Danbuoy line offset",
    "Danline direction",
    "Danbuoys",
    "Danbuoy spacing",
  ],
  CRYPTDAT: [
    "Callsign document",
    "Unit document",
    "Equipment",
    "Keying material",
    "Daily changeover",
  ],
  IVCCN: ["Net function", "Frequency designator", "Priority"],
  DALKFREQ: [
    "Circuit",
    "Frequency designator / control unit",
    "Frequency",
    "Priority",
    "Emission",
    "Usage",
  ],
  AUTOCAT: ["Station", "Minimum flight level", "Transmit", "Receive"],
  CVYORG: [
    "Commodore / OTC callsign",
    "Commodore / OTC ship",
    "Vice commodore / alternate callsign",
    "Vice commodore / alternate ship",
  ],
  RASKED: ["Rendezvous", "Position", "Mean line of advance", "Policy"],
  MTASK: ["Task order", "Unit", "MCM OTC", "Route / area", "Status"],
  COMMS: ["Unit", "Callsign"],
  MULCDUTY: ["Unit", "Name", "Rank / position", "Duty"],
};
const observed: Record<string, string[] | undefined> = {
  MSGID: [
    "Message type",
    "Standard",
    "Version",
    "Originator",
    "Serial",
    "Issue time / month",
    "Qualifier",
    "Qualifier serial",
    "Security policy",
    "Classification",
    "Release to",
  ],
  REF: [
    "Reference",
    "Message / communication type",
    "Type qualifier",
    "Originator",
    "Date / time",
    "Serial",
    "Notation",
    "Filing number",
  ],
  COMPLAN: ["Plan", "Variant", "Start", "End"],
  FREQPLAN: ["Plan", "Designator"],
  COMCHECK: ["Check time", "Unit", "Coordination"],
  COMGUARD: ["Line", "Mode", "Keying material", "Start", "End"],
  ESMTASK: ["Unit", "Equipment", "Task"],
  TASMISSN: ["Mission", "Unit"],
  SUBMISSN: ["Submarine", "Support", "Mission", "Assignment"],
  IDP: ["Report", "Responsible party", "As of", "Deadline"],
  CRYPTDAT: ["Equipment", "Keying material", "Daily changeover"],
  VOICRYPT: ["Keying material", "Daily changeover"],
  IVCCN: [
    "Net function",
    "Priority",
    "Bearer / frequency",
    "Frequency designator",
    "Keying material",
    "Callsign",
  ],
  DALKFREQ: [
    "Circuit",
    "Frequency designator / control unit",
    "Frequency",
    "Callsign",
    "Priority",
    "Emission",
    "Usage",
  ],
  AUTOCAT: ["Station", "Transmit", "Receive", "Field 4", "Altitude", "Location"],
  POCLINK: ["Duty", "Unit", "Name", "Rank / position"],
  AKNLDG: ["Acknowledgement required"],
  AEWEMPL: ["Field 1", "Field 2", "Field 3", "Frequency", "Channel", "Frequency", "Channel"],
  FORCEMAR: ["Unit", "Field 2", "Frequency", "Field 4", "Frequency", "Field 6", "TACAN"],
};
export function setFieldLabel(set: string, position: number, examples: boolean | undefined) {
  if (examples === undefined) {
    return `Field ${position}`;
  }
  const fields = (examples ? observed[set] : undefined) ?? baseline[set];
  const label = fields?.[position - 1];
  if (label !== undefined) {
    return label;
  }
  if (
    (set === "POC" && position > 4) ||
    ((set === "POCLINK" || set === "MULCDUTY") && position > 4)
  ) {
    return "Contact";
  }
  if (set === "COMPLAN" && position > 4) {
    return "Circuit";
  }
  if (set === "COMCHECK" && position > 3) {
    return "Circuit";
  }
  if (set === "COMGUARD" && position > 5) {
    return "Unit";
  }
  if (set === "IDP" && position > 4) {
    return "Delivery";
  }
  if (set === "AREA") {
    return "Point / location";
  }
  if (set === "CIRC" && position > 1) {
    return "Radius";
  }
  if (set === "CVYORG" && position > 4) {
    return "Frequency";
  }
  if (set === "COMMS" && examples && position > 2) {
    return ["Frequency / channel", "Priority", "Mode"][(position - 3) % 3];
  }
  return `Field ${position}`;
}
