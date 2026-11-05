// UI labels from the supplied 2003 USMTF set/field catalog, limited to supported OPTASK and CASREP sets.
// Source manuals and extraction/review notes remain outside the repository.
export interface CatalogField {
  name: string;
  prefix?: string;
}
export interface CatalogSet {
  name: string;
  fields: Record<number, CatalogField[] | undefined>;
  repeatFrom?: number;
}
export const setCatalog: Record<string, CatalogSet | undefined> = {
  CASLTY: {
    name: "CASUALTY REPORT",
    fields: {
      "1": [
        {
          name: "Report action",
        },
      ],
      "2": [
        {
          name: "Casualty serial",
        },
      ],
      "3": [
        {
          name: "Update sequence",
        },
      ],
      "4": [
        {
          name: "Equipment",
        },
      ],
      "5": [
        {
          name: "Equipment code",
        },
      ],
      "6": [
        {
          name: "Casualty category",
        },
      ],
      "7": [
        {
          name: "Cause code",
        },
      ],
      "8": [
        {
          name: "Reporting UIC",
        },
      ],
      "9": [
        {
          name: "Initial report reference",
        },
      ],
      "10": [
        {
          name: "Fleet",
        },
      ],
      "11": [
        {
          name: "Casualty identifier",
        },
      ],
    },
    repeatFrom: 11,
  },
  ESTIMATE: {
    name: "REPAIR ESTIMATE",
    fields: {
      "1": [
        {
          name: "Estimated repair date",
        },
      ],
      "2": [
        {
          name: "Repair comments",
        },
      ],
      "3": [
        {
          name: "Repair requirement status",
        },
      ],
    },
  },
  ASSIST: {
    name: "ASSISTANCE REQUIREMENT",
    fields: {
      "1": [
        {
          name: "Action",
        },
      ],
      "2": [
        {
          name: "Required assistance",
        },
      ],
      "3": [
        {
          name: "Location",
        },
      ],
      "4": [
        {
          name: "Coordinates",
        },
      ],
    },
  },
  TECHDATA: {
    name: "TECHNICAL DATA",
    fields: {
      "1": [
        {
          name: "Action",
        },
      ],
      "2": [
        {
          name: "Allowance list",
        },
      ],
      "3": [
        {
          name: "Component identifier",
        },
      ],
      "4": [
        {
          name: "Job control number",
        },
      ],
      "5": [
        {
          name: "Technical publication",
        },
      ],
      "6": [
        {
          name: "Publication availability",
        },
      ],
    },
    repeatFrom: 5,
  },
  PARTS: {
    name: "PARTS REQUIREMENT",
    fields: {
      "1": [
        {
          name: "Parts sequence",
        },
      ],
      "2": [
        {
          name: "Stock reference",
        },
      ],
      "3": [
        {
          name: "Stock number or part number",
        },
      ],
      "4": [
        {
          name: "Quantity required",
        },
      ],
      "5": [
        {
          name: "Allowance",
        },
      ],
      "6": [
        {
          name: "Quantity onboard",
        },
      ],
      "7": [
        {
          name: "Not in stock code",
        },
      ],
      "8": [
        {
          name: "Not carried code",
        },
      ],
      "9": [
        {
          name: "Circuit",
        },
      ],
      "10": [
        {
          name: "Material control code",
        },
      ],
      "11": [
        {
          name: "Special material identifier",
        },
      ],
    },
  },
  REQNDATA: {
    name: "REQUISITION DATA",
    fields: {
      "1": [
        {
          name: "Parts sequence",
        },
      ],
      "2": [
        {
          name: "Requisition number",
        },
      ],
      "3": [
        {
          name: "Quantity ordered",
        },
      ],
      "4": [
        {
          name: "Priority",
        },
      ],
      "5": [
        {
          name: "Project",
        },
      ],
      "6": [
        {
          name: "Required date code",
        },
      ],
      "7": [
        {
          name: "Routing",
        },
      ],
      "8": [
        {
          name: "Requisition status",
        },
      ],
      "9": [
        {
          name: "Requisition time",
        },
      ],
    },
  },
  RCPTDATA: {
    name: "PARTS RECEIPT DATA",
    fields: {
      "1": [
        {
          name: "Parts sequence",
        },
      ],
      "2": [
        {
          name: "Requisition number",
        },
      ],
      "3": [
        {
          name: "Received date",
        },
      ],
      "4": [
        {
          name: "Satisfaction code",
        },
      ],
      "5": [
        {
          name: "Quantity received",
        },
      ],
      "6": [
        {
          name: "Satisfaction designator",
        },
      ],
    },
  },
  CORRSTAT: {
    name: "CORRECTION STATISTICS",
    fields: {
      "1": [
        {
          name: "Hours between failures",
        },
      ],
      "2": [
        {
          name: "Equipment usage code",
        },
      ],
      "3": [
        {
          name: "Hours repairing",
        },
      ],
      "4": [
        {
          name: "Hours awaiting parts",
        },
      ],
    },
  },
  AKNLDG: {
    name: "ACKNOWLEDGEMENT REQUIREMENT",
    fields: {
      "1": [
        {
          name: "Acknowledgement requirement indicator",
        },
      ],
      "2": [
        {
          name: "Instructions for acknowledging",
          prefix: "INST",
        },
        {
          name: "Force or unit required to acknowledge",
        },
      ],
    },
    repeatFrom: 2,
  },
  ALFACUST: {
    name: "REPLENISHMENT AT SEA METHOD ALFA CUSTOMER SHIP INSTRUCTIONS",
    fields: {
      "1": [
        {
          name: "Ship name",
        },
        {
          name: "Unit",
          prefix: "UNIT",
        },
      ],
      "2": [
        {
          name: "Timeframe designator",
        },
      ],
      "3": [
        {
          name: "Phonetic alphabetic identifier",
        },
      ],
      "4": [
        {
          name: "Supply ship station phonetic identifier",
        },
      ],
    },
    repeatFrom: 4,
  },
  ALFASUPL: {
    name: "REPLENISHMENT AT SEA METHOD ALFA SEQUENCE OF SUPPLYING SHIP",
    fields: {
      "1": [
        {
          name: "Supplying ship name",
        },
        {
          name: "Unit",
          prefix: "UNIT",
        },
      ],
    },
    repeatFrom: 1,
  },
  AMPN: {
    name: "AMPLIFICATION",
    fields: {
      "1": [
        {
          name: "Free text",
        },
      ],
    },
  },
  ANCHOR: {
    name: "ANCHOR INSTRUCTIONS",
    fields: {
      "1": [
        {
          name: "Unit name",
          prefix: "UNIT",
        },
        {
          name: "Ship name",
        },
      ],
      "2": [
        {
          name: "Verified start day-time",
        },
      ],
      "3": [
        {
          name: "Verified end day-time",
        },
      ],
      "4": [
        {
          name: "Geographic location, verified lat/long, seconds",
        },
        {
          name: "Location, verified, lat/long, deciseconds",
        },
        {
          name: "Verified true bearing and distance from ref pt",
        },
        {
          name: "Q-ROUTE position",
          prefix: "POSIT",
        },
        {
          name: "Location, verified, lat/long, thousandths of minute",
        },
        {
          name: "Location, UTM 1-meter",
        },
        {
          name: "Geographic location, UTM 10-meter",
        },
        {
          name: "Geographic location, UTM 100-meter",
        },
        {
          name: "Location, UTM 1000-meter",
        },
        {
          name: "Location, georef, minute",
        },
        {
          name: "Location, georef, centiminute",
        },
        {
          name: "Location, abbrev georef, minutes",
        },
        {
          name: "Location, abbrev georef, centiminute",
        },
      ],
    },
  },
  AREA: {
    name: "AREA",
    fields: {
      "1": [
        {
          name: "Point name",
        },
        {
          name: "Location, lat/long, degrees",
        },
        {
          name: "Geographic location, lat/long, minutes",
        },
        {
          name: "Geographic location, lat/long, seconds",
        },
        {
          name: "Location, abbrev georef, minutes",
        },
        {
          name: "Location, georef, minute",
        },
        {
          name: "Location, abbrev georef, centiminute",
        },
        {
          name: "Location, georef, centiminute",
        },
        {
          name: "Location, UTM 1000-meter",
        },
        {
          name: "Geographic location, UTM 100-meter",
        },
        {
          name: "Geographic location, UTM 10-meter",
        },
        {
          name: "Location, UTM 1-meter",
        },
        {
          name: "Location, verified lat/long, degrees",
        },
        {
          name: "Location, verified lat/long, minutes",
        },
        {
          name: "Geographic location, verified lat/long, seconds",
        },
        {
          name: "True bearing and distance in nm from reference point",
        },
        {
          name: "Bearing and distance from ref pt",
        },
        {
          name: "Location, verified, lat/long, deciseconds",
        },
        {
          name: "Verified true bearing and distance from ref pt",
        },
        {
          name: "Q-ROUTE position",
          prefix: "POSIT",
        },
        {
          name: "Location, verified, lat/long, thousandths of minute",
        },
      ],
    },
    repeatFrom: 1,
  },
  ARUDATA: {
    name: "ATDL-1 REPORTING UNIT (RU) DATA",
    fields: {
      "1": [
        {
          name: "Base name",
          prefix: "BASE",
        },
        {
          name: "Place name",
          prefix: "PLACE",
        },
        {
          name: "Task organization commander",
          prefix: "CDR",
        },
        {
          name: "Station designator",
          prefix: "STAT",
        },
        {
          name: "Unit designator",
          prefix: "UNIT",
        },
        {
          name: "Nadge site designator",
          prefix: "NADGE",
        },
      ],
      "2": [
        {
          name: "Unit call sign",
          prefix: "CS",
        },
        {
          name: "Call sign line number",
          prefix: "CSLN",
        },
      ],
      "3": [
        {
          name: "Atdl-1 unit address",
          prefix: "AUA",
        },
        {
          name: "Link unit line number",
          prefix: "LULN",
        },
      ],
      "4": [
        {
          name: "Atdl-1 track number block",
        },
      ],
      "5": [
        {
          name: "Geographic location, lat/long, seconds",
        },
      ],
      "6": [
        {
          name: "Link duty",
        },
      ],
    },
    repeatFrom: 6,
  },
  ASULINK: {
    name: "ATDL-1 SUPPORTING UNIT (SU)",
    fields: {
      "1": [
        {
          name: "First atdl-1 unit address",
          prefix: "FAUA",
        },
        {
          name: "Link unit line number",
          prefix: "LULN",
        },
      ],
      "2": [
        {
          name: "Second atdl-1 unit address",
          prefix: "SAUA",
        },
        {
          name: "Link unit line number",
          prefix: "LULN",
        },
      ],
      "3": [
        {
          name: "Link net speed",
        },
      ],
      "4": [
        {
          name: "Type of connectivity",
        },
      ],
      "5": [
        {
          name: "Initialization/reinitialization mode",
        },
      ],
    },
  },
  AUTOCAT: {
    name: "AIRBORNE RADIO RELAY STATION INFORMATION",
    fields: {
      "1": [
        {
          name: "Station designator",
        },
      ],
      "2": [
        {
          name: "Minimum flight level in hundreds of feet",
          prefix: "MINALT",
        },
      ],
      "3": [
        {
          name: "Relay transmitting frequency in megahertz",
          prefix: "TX",
        },
        {
          name: "Relay transmitting frequency designator",
          prefix: "TX",
        },
        {
          name: "Relay transmitting frequency",
          prefix: "TX",
        },
      ],
      "4": [
        {
          name: "Relay receiving frequency in megahertz",
          prefix: "REC",
        },
        {
          name: "Relay receiving frequency designator",
          prefix: "REC",
        },
        {
          name: "Relay receiving frequency",
          prefix: "REC",
        },
      ],
      "5": [
        {
          name: "Station location, lat/long, minutes",
        },
        {
          name: "Station location, georef, minute",
        },
        {
          name: "Station location, bearing and range",
        },
        {
          name: "Station name",
        },
      ],
    },
    repeatFrom: 5,
  },
  BDCT: {
    name: "BROADCAST WATCH",
    fields: {
      "1": [
        {
          name: "Set watch day-time",
        },
        {
          name: "Verified day-time set watch",
        },
      ],
      "2": [
        {
          name: "Area broadcast designator",
        },
        {
          name: "Ship-shore communication identifier",
          prefix: "SSCOM",
        },
        {
          name: "Naval/amphibious communications net line number",
        },
        {
          name: "Local/harbor communications identifier",
        },
        {
          name: "Broadcast call sign",
          prefix: "BCS",
        },
        {
          name: "Multichannel area broadcast designator",
          prefix: "MCBD",
        },
      ],
      "3": [
        {
          name: "Shift watch day-time",
        },
        {
          name: "Verified day-time shift watch",
        },
      ],
      "4": [
        {
          name: "Area broadcast designator",
        },
        {
          name: "Ship-shore communication identifier",
          prefix: "SSCOM",
        },
        {
          name: "Naval/amphibious communications net line number",
        },
        {
          name: "Local/harbor communications identifier",
        },
        {
          name: "Broadcast call sign",
          prefix: "BCS",
        },
        {
          name: "Multichannel area broadcast designator",
          prefix: "MCBD",
        },
      ],
    },
    repeatFrom: 3,
  },
  BOUNDARY: {
    name: "BOUNDARY LIMITS",
    fields: {
      "1": [
        {
          name: "Boundary qualifier",
        },
      ],
      "2": [
        {
          name: "Boundary lower limit, speed",
        },
        {
          name: "Boundary lower limit, flight level",
        },
        {
          name: "Boundary lower limit, altitude",
        },
        {
          name: "Amsl lower altitude limit",
        },
        {
          name: "Lower limit, heading",
        },
      ],
      "3": [
        {
          name: "Boundary upper limit, speed",
        },
        {
          name: "Boundary upper limit, flight level",
        },
        {
          name: "Boundary upper limit, altitude",
        },
        {
          name: "Amsl upper altitude limit",
        },
        {
          name: "Upper limit, heading",
        },
      ],
    },
    repeatFrom: 1,
  },
  BRAVDET: {
    name: "REPLENISHMENT AT SEA METHOD BRAVO DETAILS",
    fields: {
      "1": [
        {
          name: "Supplying ship name",
        },
        {
          name: "Unit",
          prefix: "UNIT",
        },
      ],
      "2": [
        {
          name: "Ship name",
        },
        {
          name: "Unit",
          prefix: "UNIT",
        },
      ],
      "3": [
        {
          name: "Phonetic alphabetic-numeric identifier",
        },
        {
          name: "Phonetic numeric-alphabetic identifier",
        },
      ],
    },
    repeatFrom: 3,
  },
  CANX: {
    name: "MESSAGE CANCELLATION WITH NEW INFORMATION PROVIDED",
    fields: {
      "1": [
        {
          name: "Message text format identifier",
        },
        {
          name: "Communication type",
        },
      ],
      "2": [
        {
          name: "Originator",
        },
      ],
      "3": [
        {
          name: "Date of reference, year-month-day",
          prefix: "YMD",
        },
        {
          name: "Reference day-time",
        },
        {
          name: "Reference date-time group",
        },
        {
          name: "Date of reference, day-alphamonth-year",
        },
        {
          name: "Day-time and month of reference",
        },
        {
          name: "Verified day-time of reference",
        },
        {
          name: "Verified month date-time of reference",
        },
        {
          name: "Verified date-time group of reference",
        },
        {
          name: "Day-time group of reference",
          prefix: "DTIME",
        },
      ],
      "4": [
        {
          name: "Serial number of reference",
        },
      ],
      "5": [
        {
          name: "Special notation",
        },
      ],
      "6": [
        {
          name: "SIC code",
        },
        {
          name: "Filing number",
        },
      ],
    },
    repeatFrom: 6,
  },
  CHANDAT: {
    name: "CHANNEL INFORMATION",
    fields: {
      "1": [
        {
          name: "Q-ROUTE point identifier code",
        },
        {
          name: "Position designator",
        },
      ],
      "2": [
        {
          name: "Geographic location, verified lat/long, seconds",
        },
        {
          name: "Location, verified, lat/long, deciseconds",
        },
        {
          name: "Verified true bearing and distance from ref pt",
        },
        {
          name: "Q-ROUTE position",
          prefix: "POSIT",
        },
        {
          name: "Location, verified, lat/long, thousandths of minute",
        },
        {
          name: "Location, UTM 1-meter",
        },
        {
          name: "Geographic location, UTM 10-meter",
        },
        {
          name: "Geographic location, UTM 100-meter",
        },
        {
          name: "Location, UTM 1000-meter",
        },
        {
          name: "Location, georef, minute",
        },
        {
          name: "Location, georef, centiminute",
        },
        {
          name: "Location, abbrev georef, minutes",
        },
        {
          name: "Location, abbrev georef, centiminute",
        },
      ],
      "3": [
        {
          name: "Geographic location, verified lat/long, seconds",
        },
        {
          name: "Location, verified, lat/long, deciseconds",
        },
        {
          name: "Verified true bearing and distance from ref pt",
        },
        {
          name: "Q-ROUTE position",
          prefix: "POSIT",
        },
        {
          name: "Location, verified, lat/long, thousandths of minute",
        },
        {
          name: "Location, UTM 1-meter",
        },
        {
          name: "Geographic location, UTM 10-meter",
        },
        {
          name: "Geographic location, UTM 100-meter",
        },
        {
          name: "Location, UTM 1000-meter",
        },
        {
          name: "Location, georef, minute",
        },
        {
          name: "Location, georef, centiminute",
        },
        {
          name: "Location, abbrev georef, minutes",
        },
        {
          name: "Location, abbrev georef, centiminute",
        },
      ],
      "4": [
        {
          name: "Verified channel direction",
        },
      ],
      "5": [
        {
          name: "Verified channel length in nautical miles",
        },
      ],
      "6": [
        {
          name: "Verified channel width in meters or yards",
        },
      ],
      "7": [
        {
          name: "Verified tidal stream course/speed in knots",
        },
      ],
      "8": [
        {
          name: "Verified start day-time",
        },
      ],
      "9": [
        {
          name: "Verified end day-time",
        },
      ],
      "10": [
        {
          name: "Verified danbuoy line offset in meters or yards",
        },
      ],
      "11": [
        {
          name: "Verified danline direction",
        },
      ],
      "12": [
        {
          name: "Number of danbuoys",
        },
      ],
      "13": [
        {
          name: "Verified danbuoy spacing in meters or yards",
        },
      ],
    },
  },
  CIRC: {
    name: "CIRCULAR AREA",
    fields: {
      "1": [
        {
          name: "Unit location, verified lat/long, minutes",
        },
        {
          name: "Place name",
          prefix: "N",
        },
        {
          name: "Center of circle, bearing/distance from ref pt",
        },
        {
          name: "Center of circle, UTM 10-meter",
        },
        {
          name: "Center of circle, georef, centiminute",
        },
        {
          name: "Geographic location, verified lat/long, seconds",
        },
        {
          name: "Location, verified, lat/long, deciseconds",
        },
        {
          name: "Verified true bearing and distance from ref pt",
        },
        {
          name: "Q-ROUTE position",
          prefix: "POSIT",
        },
        {
          name: "Location, verified, lat/long, thousandths of minute",
        },
        {
          name: "Location, UTM 1-meter",
        },
        {
          name: "Geographic location, UTM 100-meter",
        },
        {
          name: "Location, UTM 1000-meter",
        },
        {
          name: "Location, georef, minute",
        },
        {
          name: "Location, abbrev georef, minutes",
        },
        {
          name: "Location, abbrev georef, centiminute",
        },
        {
          name: "Geographic location, lat/long, minutes",
        },
        {
          name: "True bearing and distance in nm from reference point",
        },
        {
          name: "Ship name",
        },
        {
          name: "Unit name",
          prefix: "UNIT",
        },
      ],
      "2": [
        {
          name: "Circle radius",
        },
      ],
    },
    repeatFrom: 2,
  },
  CODING: {
    name: "CODING SYSTEM",
    fields: {
      "1": [
        {
          name: "Phonetic alphabetic identifier",
        },
      ],
      "2": [
        {
          name: "Type of coding",
        },
      ],
      "3": [
        {
          name: "Effective publication",
        },
      ],
      "4": [
        {
          name: "Verified time of change",
        },
      ],
    },
    repeatFrom: 2,
  },
  COMMS: {
    name: "COMMUNICATIONS",
    fields: {
      "1": [
        {
          name: "Unit",
        },
        {
          name: "Specific unit designator",
          prefix: "UD",
        },
      ],
      "2": [
        {
          name: "Specific call sign",
        },
      ],
      "3": [
        {
          name: "Specific radio frequency",
        },
        {
          name: "Communications channel number",
        },
        {
          name: "Communications code",
          prefix: "CC",
        },
      ],
      "4": [
        {
          name: "Communication priority",
        },
      ],
      "5": [
        {
          name: "Transmission mode",
        },
      ],
    },
    repeatFrom: 3,
  },
  CONTAMIN: {
    name: "CONTAMINATION ACCEPTABILITY",
    fields: {
      "1": [
        {
          name: "Generic platform type",
        },
      ],
      "2": [
        {
          name: "Contamination indicator",
        },
      ],
    },
    repeatFrom: 1,
  },
  COTI: {
    name: "MINE EMBARKATION",
    fields: {
      "1": [
        {
          name: "Verified day-time",
        },
        {
          name: "Verified month date-time",
        },
        {
          name: "Commencement time qualifier",
        },
      ],
      "2": [
        {
          name: "Embarkation harbor",
        },
      ],
    },
  },
  COVER: {
    name: "COVERING FORCES",
    fields: {
      "1": [
        {
          name: "Unit name",
        },
        {
          name: "Organization designator",
        },
      ],
    },
    repeatFrom: 1,
  },
  CRYPTDAT: {
    name: "CRYPTOGRAPHIC DATA",
    fields: {
      "1": [
        {
          name: "Callsign line number document",
        },
      ],
      "2": [
        {
          name: "Unit line number document",
        },
      ],
      "3": [
        {
          name: "Link cryptographic equipment name",
        },
      ],
      "4": [
        {
          name: "Crypto keying material",
        },
      ],
      "5": [
        {
          name: "Daily crypto shift time",
        },
      ],
    },
    repeatFrom: 3,
  },
  CVYORG: {
    name: "CONVOY ORGANIZATION",
    fields: {
      "1": [
        {
          name: "Convoy commodore call sign",
        },
        {
          name: "OTC call sign",
          prefix: "OTC",
        },
        {
          name: "Naval force call sign",
          prefix: "FORCE",
        },
      ],
      "2": [
        {
          name: "Commodore's ship name",
        },
        {
          name: "OTC ship name",
          prefix: "OTC",
        },
      ],
      "3": [
        {
          name: "Convoy vice commodore call sign",
        },
        {
          name: "Alternate OTC call sign",
          prefix: "AOTC",
        },
      ],
      "4": [
        {
          name: "Vice commodore's ship name",
        },
        {
          name: "Alternate OTC ship name",
          prefix: "AOTC",
        },
      ],
      "5": [
        {
          name: "Specific radio frequency",
        },
      ],
    },
    repeatFrom: 5,
  },
  DALKFREQ: {
    name: "DATA LINK FREQUENCY INFORMATION",
    fields: {
      "1": [
        {
          name: "Link circuit function",
        },
      ],
      "2": [
        {
          name: "Frequency designator",
          prefix: "FD",
        },
        {
          name: "Control unit designator",
          prefix: "CU",
        },
      ],
      "3": [
        {
          name: "Assigned radio frequency",
        },
      ],
      "4": [
        {
          name: "Communication priority",
        },
      ],
      "5": [
        {
          name: "Data link emission designator",
        },
      ],
      "6": [
        {
          name: "Frequency usage indicator",
        },
      ],
    },
  },
  DAMA: {
    name: "DEMAND ASSIGNED MULTIPLE ACCESS",
    fields: {
      "1": [
        {
          name: "Guard number",
        },
      ],
      "2": [
        {
          name: "Channel connector",
        },
      ],
      "3": [
        {
          name: "Data rate of a communications satellite access",
        },
      ],
    },
  },
  DIVERT: {
    name: "DIVERSION INSTRUCTIONS",
    fields: {
      "1": [
        {
          name: "Geographic location, verified lat/long, seconds",
        },
        {
          name: "Location, verified, lat/long, deciseconds",
        },
        {
          name: "Verified true bearing and distance from ref pt",
        },
        {
          name: "Q-ROUTE position",
          prefix: "POSIT",
        },
        {
          name: "Location, verified, lat/long, thousandths of minute",
        },
        {
          name: "Location, UTM 1-meter",
        },
        {
          name: "Geographic location, UTM 10-meter",
        },
        {
          name: "Geographic location, UTM 100-meter",
        },
        {
          name: "Location, UTM 1000-meter",
        },
        {
          name: "Location, georef, minute",
        },
        {
          name: "Location, georef, centiminute",
        },
        {
          name: "Location, abbrev georef, minutes",
        },
        {
          name: "Location, abbrev georef, centiminute",
        },
      ],
      "2": [
        {
          name: "Verified course with tenths of a degree",
        },
      ],
    },
    repeatFrom: 1,
  },
  DLRPGRID: {
    name: "DATA LINK REFERENCE POINT AND GRID ORIGIN INFORMATION",
    fields: {
      "1": [
        {
          name: "Data link reference point type",
        },
      ],
      "2": [
        {
          name: "Point designator",
        },
      ],
      "3": [
        {
          name: "Reference point name",
          prefix: "REF",
        },
        {
          name: "Bearing and distance from ref pt",
          prefix: "BDREF",
        },
        {
          name: "Place name",
          prefix: "PLACE",
        },
        {
          name: "Location, UTM 10-meter",
          prefix: "GPU",
        },
        {
          name: "Geographic location, lat/long, minutes",
          prefix: "GPLLM",
        },
        {
          name: "Location, georef, minute",
          prefix: "GPGM",
        },
      ],
      "4": [
        {
          name: "Effective date-time group",
        },
      ],
    },
  },
  DUSTAREA: {
    name: "DUSTBIN AREA",
    fields: {
      "1": [
        {
          name: "Dustbin area type",
        },
      ],
      "2": [
        {
          name: "Verified start day-time",
        },
        {
          name: "Verified month date-time of start",
        },
      ],
      "3": [
        {
          name: "Verified end day-time",
        },
        {
          name: "Verified month date-time of stop",
        },
      ],
      "4": [
        {
          name: "Axis, qualified",
        },
      ],
      "5": [
        {
          name: "Dustbin area diameter",
        },
      ],
    },
  },
  DUTY: {
    name: "DUTY",
    fields: {
      "1": [
        {
          name: "Ship identification",
        },
        {
          name: "Ship name",
        },
        {
          name: "Place name",
        },
        {
          name: "Unit call sign",
        },
        {
          name: "Station designator",
        },
        {
          name: "Unit designator",
        },
        {
          name: "Aircraft type and model",
        },
        {
          name: "Interface unit designation",
        },
        {
          name: "Base name",
          prefix: "BASE",
        },
        {
          name: "Specific ship identification",
        },
      ],
      "2": [
        {
          name: "Duty assigned",
        },
        {
          name: "Duty table",
        },
        {
          name: "Missile mission duty",
        },
        {
          name: "Link duty",
        },
      ],
    },
    repeatFrom: 2,
  },
  EMCON: {
    name: "EMISSION CONTROL PLAN",
    fields: {
      "1": [
        {
          name: "Emission control plan phonetic identifier",
        },
        {
          name: "Emission control plan identifier",
        },
      ],
      "2": [
        {
          name: "Start day-time",
        },
        {
          name: "Verified start day-time",
        },
      ],
      "3": [
        {
          name: "Termination day-time",
        },
        {
          name: "Verified end day-time",
        },
      ],
    },
    repeatFrom: 1,
  },
  EMCONFM: {
    name: "EMISSION CONTROL PLAN FORMAT",
    fields: {
      "1": [
        {
          name: "Format index letter",
        },
        {
          name: "Format index number",
        },
      ],
      "2": [
        {
          name: "Specific equipment type",
        },
        {
          name: "Tactical unit type",
          prefix: "UNIT",
        },
      ],
    },
    repeatFrom: 1,
  },
  EMCONPL: {
    name: "EMISSION CONTROL PLAN INDICATORS",
    fields: {
      "1": [
        {
          name: "Emission control plan designation",
        },
      ],
      "2": [
        {
          name: "Format index letter",
        },
      ],
      "3": [
        {
          name: "Radiation status indicator",
        },
      ],
    },
    repeatFrom: 2,
  },
  FORCFLTR: {
    name: "FORCE FILTER DETAILS",
    fields: {
      "1": [
        {
          name: "Filter identifier number",
        },
      ],
      "2": [
        {
          name: "Filter region",
        },
      ],
      "3": [
        {
          name: "Link-16 filter management number",
        },
      ],
      "4": [
        {
          name: "Area filter status",
        },
      ],
      "5": [
        {
          name: "Position designator",
          prefix: "APD",
        },
        {
          name: "Network participant identifier sequence number",
          prefix: "NPI",
        },
      ],
      "6": [
        {
          name: "Environmental category filter",
        },
      ],
      "7": [
        {
          name: "Identification filter",
        },
      ],
      "8": [
        {
          name: "Special filter",
        },
      ],
    },
    repeatFrom: 6,
  },
  FORM: {
    name: "FORMATION",
    fields: {
      "1": [
        {
          name: "Naval task designator",
          prefix: "NT",
        },
        {
          name: "Non-discrete indicator, na/other/as signaled",
          prefix: "ND",
        },
      ],
      "2": [
        {
          name: "Axis, qualified",
        },
      ],
      "3": [
        {
          name: "Interval/spacing distance, in/ft/yd/nm/m/km/kyd/mdr",
        },
      ],
      "4": [
        {
          name: "Maritime distance",
        },
      ],
    },
  },
  FUELEST: {
    name: "FUEL ESTIMATE",
    fields: {
      "1": [
        {
          name: "Supplying ship name",
        },
        {
          name: "Unit",
          prefix: "UNIT",
        },
      ],
      "2": [
        {
          name: "NATO standard fuel type",
        },
      ],
      "3": [
        {
          name: "Volume, cubic meters",
        },
      ],
    },
    repeatFrom: 2,
  },
  FYFCE: {
    name: "FRIENDLY FORCES",
    fields: {
      "1": [
        {
          name: "Unit designation",
        },
      ],
      "2": [
        {
          name: "Number of cooperating forces",
        },
      ],
      "3": [
        {
          name: "Ship type identification",
        },
        {
          name: "Cooperating forces name",
        },
      ],
    },
    repeatFrom: 2,
  },
  FYPOS: {
    name: "FRIENDLY FORCES POSITION",
    fields: {
      "1": [
        {
          name: "Unit designation",
        },
        {
          name: "Specific friendly unit designator",
          prefix: "TUD",
        },
      ],
      "2": [
        {
          name: "Friendly force location, name",
          prefix: "NAME",
        },
        {
          name: "Friendly forces position, bearing and distance",
          prefix: "BD",
        },
        {
          name: "Friendly forces position, lat/long, degrees",
        },
        {
          name: "Position of friendly unit, lat/long, minutes",
        },
        {
          name: "Friendly forces position, lat/long, seconds",
        },
        {
          name: "Friendly forces position, UTM 1000-meter",
        },
        {
          name: "Friendly forces position, UTM 100-meter",
        },
        {
          name: "Friendly force location, UTM 10-meter",
        },
        {
          name: "Friendly forces position, UTM 1-meter",
        },
        {
          name: "Friendly forces position, abbrev georef, minutes",
        },
        {
          name: "Friendly forces position, georef, minute",
        },
        {
          name: "Friendly forces position abbrev georef, centiminute",
        },
        {
          name: "Friendly force location, georef, centiminute",
        },
        {
          name: "Position of friendly unit, verified lat/long, minutes",
        },
        {
          name: "Friendly forces position, verified lat/long, seconds",
        },
        {
          name: "Port code",
        },
        {
          name: "Friendly forces position, bearing/distance from ref pt",
        },
        {
          name: "Location, verified, lat/long, deciseconds",
        },
        {
          name: "Location, verified, lat/long, thousandths of minute",
        },
        {
          name: "Verified true bearing and distance from ref pt",
          prefix: "VBDRP",
        },
        {
          name: "Q-ROUTE position",
          prefix: "POSIT",
        },
        {
          name: "Verified bearing and distance",
          prefix: "VBD",
        },
        {
          name: "Friendly forces position, bearing and range",
        },
      ],
      "3": [
        {
          name: "Military day-time",
        },
        {
          name: "Verified day-time",
        },
      ],
      "4": [
        {
          name: "Friendly force course and speed",
        },
        {
          name: "True course and relative speed",
        },
      ],
      "5": [
        {
          name: "Flag",
        },
      ],
      "6": [
        {
          name: "Discrete identifier code",
        },
      ],
    },
  },
  GENTEXT: {
    name: "GENERAL TEXT INFORMATION",
    fields: {
      "1": [
        {
          name: "Gentext text indicator",
        },
      ],
      "2": [
        {
          name: "Free text",
        },
      ],
    },
  },
  GEODATUM: {
    name: "GEODETIC DATUM",
    fields: {
      "1": [
        {
          name: "Geodetic datum",
        },
      ],
    },
  },
  HEADING: {
    name: "HEADING FOR SEGMENTS OF A MESSAGE",
    fields: {
      "1": [
        {
          name: "Heading information",
        },
      ],
    },
  },
  INDIRIUF: {
    name: "INDIRECT INTERFACE UNIT FILTER",
    fields: {
      "1": [
        {
          name: "Filter identifier",
        },
      ],
      "2": [
        {
          name: "Reporting unit (ru) number",
          prefix: "RU",
        },
        {
          name: "Primary JTIDS unit address",
          prefix: "JU",
        },
        {
          name: "Participating unit number",
          prefix: "PU",
        },
        {
          name: "Link 1 reporting (ru) number",
          prefix: "LU",
        },
        {
          name: "Atdl-1 unit address",
          prefix: "AU",
        },
      ],
    },
    repeatFrom: 2,
  },
  INDIUDAT: {
    name: "INDIRECT INTERFACE UNIT DATA",
    fields: {
      "1": [
        {
          name: "Ship identification",
          prefix: "ID",
        },
        {
          name: "Ship name",
          prefix: "SHIP",
        },
        {
          name: "Base name",
          prefix: "BASE",
        },
        {
          name: "Place name",
          prefix: "PLACE",
        },
        {
          name: "Task organization commander",
          prefix: "CDR",
        },
        {
          name: "Station designator",
          prefix: "STAT",
        },
        {
          name: "Unit designator",
          prefix: "UNIT",
        },
        {
          name: "Aircraft type and model",
          prefix: "AC",
        },
      ],
      "2": [
        {
          name: "Primary JTIDS unit address",
          prefix: "PRI",
        },
        {
          name: "Link unit line number",
          prefix: "LULN",
        },
      ],
      "3": [
        {
          name: "Specific call sign",
        },
      ],
      "4": [
        {
          name: "Link 16 abbreviated call sign",
        },
      ],
      "5": [
        {
          name: "Track number block assignment, numeric",
          prefix: "BLOCK",
        },
      ],
    },
  },
  INTCOORD: {
    name: "INTERFACE COORDINATION",
    fields: {
      "1": [
        {
          name: "Interface coordination",
        },
      ],
    },
  },
  IVCCN: {
    name: "INTERFACE VOICE CONTROL AND COORDINATION NETS",
    fields: {
      "1": [
        {
          name: "Voice control and coordination net function",
        },
      ],
      "2": [
        {
          name: "Frequency designator",
        },
      ],
      "3": [
        {
          name: "Communication priority",
        },
      ],
      "4": [
        {
          name: "Nonsecure telephone number, international",
          prefix: "TEL",
        },
        {
          name: "Secure telephone number, international",
          prefix: "SECTEL",
        },
        {
          name: "Nonsecure tactical telephone number",
          prefix: "TELTAC",
        },
        {
          name: "Secure tactical telephone number",
          prefix: "SECTAC",
        },
        {
          name: "Assigned radio frequency",
          prefix: "ASGN",
        },
      ],
    },
    repeatFrom: 4,
  },
  JCNTROPT: {
    name: "CONTROL OPTION",
    fields: {
      "1": [
        {
          name: "Network participation group option number",
        },
      ],
      "2": [
        {
          name: "Network participation group option sequence number",
        },
      ],
      "3": [
        {
          name: "Air control net number",
        },
      ],
      "4": [
        {
          name: "Event",
        },
      ],
    },
  },
  JCRYPDAT: {
    name: "LINK 16 CRYPTOGRAPHIC DATA",
    fields: {
      "1": [
        {
          name: "Cryptovariable logical label (cvll)",
        },
      ],
      "2": [
        {
          name: "Key short title",
        },
      ],
      "3": [
        {
          name: "Encryption key short title",
        },
      ],
      "4": [
        {
          name: "Secure data unit (sdu) location number",
        },
      ],
    },
    repeatFrom: 3,
  },
  JNETWORK: {
    name: "JOINT NETWORK INITIALIZATION DATA",
    fields: {
      "1": [
        {
          name: "Network identifier",
        },
      ],
      "2": [
        {
          name: "National network identifier",
        },
      ],
      "3": [
        {
          name: "Network origination date",
        },
      ],
      "4": [
        {
          name: "JTIDS network library identification number",
        },
      ],
      "5": [
        {
          name: "Network priority type designation code",
        },
      ],
    },
  },
  JSTNETS: {
    name: "STACKED NETS",
    fields: {
      "1": [
        {
          name: "Network participation group name",
        },
      ],
      "2": [
        {
          name: "Network participation group number",
        },
      ],
      "3": [
        {
          name: "Link net number",
        },
      ],
      "4": [
        {
          name: "Net usage/function",
        },
      ],
    },
    repeatFrom: 3,
  },
  JTRNMODE: {
    name: "TRANSMISSION MODE",
    fields: {
      "1": [
        {
          name: "Link-16 terminal test mode",
        },
      ],
      "2": [
        {
          name: "Interference protection feature override",
        },
      ],
      "3": [
        {
          name: "Link-16 range mode",
        },
      ],
      "4": [
        {
          name: "Link-16 communications mode",
        },
      ],
    },
  },
  JUDATA: {
    name: "JOINT TACTICAL INFORMATION DISTRIBUTION SYSTEM (JTIDS) UNIT DATA",
    fields: {
      "1": [
        {
          name: "Ship identification",
          prefix: "ID",
        },
        {
          name: "Ship name",
          prefix: "SHIP",
        },
        {
          name: "Base name",
          prefix: "BASE",
        },
        {
          name: "Place name",
          prefix: "PLACE",
        },
        {
          name: "Task organization commander",
          prefix: "CDR",
        },
        {
          name: "Station designator",
          prefix: "STAT",
        },
        {
          name: "Unit designator",
          prefix: "UNIT",
        },
        {
          name: "Aircraft type and model",
          prefix: "AC",
        },
      ],
      "2": [
        {
          name: "Specific call sign",
          prefix: "CS",
        },
        {
          name: "Call sign line number",
          prefix: "CSLN",
        },
      ],
      "3": [
        {
          name: "Link 16 abbreviated call sign",
        },
      ],
      "4": [
        {
          name: "Primary JTIDS unit address",
          prefix: "PRI",
        },
        {
          name: "Link unit line number",
          prefix: "LULN",
        },
      ],
      "5": [
        {
          name: "Data type",
        },
      ],
      "6": [
        {
          name: "Track number block assignment, numeric",
          prefix: "BLOCK",
        },
      ],
      "7": [
        {
          name: "Ijms track number block assignment",
        },
      ],
      "8": [
        {
          name: "Network participant identification",
        },
      ],
      "9": [
        {
          name: "Participant user sequence number",
        },
      ],
      "10": [
        {
          name: "JTIDS/MIDS transmission mode",
        },
      ],
      "11": [
        {
          name: "Power output level",
        },
      ],
      "12": [
        {
          name: "Unit user type",
        },
      ],
      "13": [
        {
          name: "Initial entry unit transmission indicator",
        },
      ],
      "14": [
        {
          name: "NATO track number root",
        },
      ],
      "15": [
        {
          name: "Secondary JTIDS unit address",
        },
      ],
      "16": [
        {
          name: "Forwarding track number block assignment",
          prefix: "FBLOCK",
        },
      ],
    },
    repeatFrom: 16,
  },
  LNKI: {
    name: "LINK 1",
    fields: {
      "1": [
        {
          name: "Link 1",
        },
      ],
    },
  },
  LNKIRU: {
    name: "LINK 1 REPORTING UNIT (RU) DATA",
    fields: {
      "1": [
        {
          name: "Base name",
          prefix: "BASE",
        },
        {
          name: "Place name",
          prefix: "PLACE",
        },
        {
          name: "Task organization commander",
          prefix: "CDR",
        },
        {
          name: "Station designator",
          prefix: "STAT",
        },
        {
          name: "Designation of unit",
          prefix: "UNIT",
        },
        {
          name: "Nadge site designator",
          prefix: "NADGE",
        },
        {
          name: "Air command and control system (accs) designation",
          prefix: "ACCS",
        },
      ],
      "2": [
        {
          name: "Unit call sign",
          prefix: "CS",
        },
        {
          name: "Call sign line number",
          prefix: "CSLN",
        },
      ],
      "3": [
        {
          name: "Link 1 reporting (ru) number",
          prefix: "LRU",
        },
        {
          name: "Crypto publication line number",
          prefix: "LULN",
        },
      ],
      "4": [
        {
          name: "Link 1 track number block",
          prefix: "BLOCK",
        },
      ],
      "5": [
        {
          name: "Geographic location, lat/long, seconds",
        },
      ],
    },
  },
  LNKISCC: {
    name: "LINK 1 SYSTEM COORDINATE CENTER",
    fields: {
      "1": [
        {
          name: "Geographic location, lat/long, seconds",
          prefix: "GLOC",
        },
        {
          name: "Location, georef, centiminute",
          prefix: "GREF",
        },
      ],
      "2": [
        {
          name: "Link-1 system coordinate center name",
        },
      ],
    },
  },
  LNKSAT: {
    name: "SATELLITE LINK 16",
    fields: {
      "1": [
        {
          name: "Satellite link 16",
        },
      ],
    },
  },
  LNKXI: {
    name: "LINK 11",
    fields: {
      "1": [
        {
          name: "Link 11",
        },
      ],
    },
  },
  LNKXIB: {
    name: "LINK 11B",
    fields: {
      "1": [
        {
          name: "Link 11b",
        },
      ],
    },
  },
  LPUDATA: {
    name: "LINK PARTICIPATING UNIT (PU) DATA",
    fields: {
      "1": [
        {
          name: "Ship identification",
          prefix: "ID",
        },
        {
          name: "Ship name",
          prefix: "SHIP",
        },
        {
          name: "Base name",
          prefix: "BASE",
        },
        {
          name: "Place name",
          prefix: "PLACE",
        },
        {
          name: "Task organization commander",
          prefix: "CDR",
        },
        {
          name: "Station designator",
          prefix: "STAT",
        },
        {
          name: "Designation of unit",
          prefix: "UNIT",
        },
        {
          name: "Aircraft type and model",
          prefix: "AC",
        },
        {
          name: "Nadge site designator",
          prefix: "NADGE",
        },
      ],
      "2": [
        {
          name: "Specific call sign",
          prefix: "CS",
        },
        {
          name: "Call sign line number",
          prefix: "CSLN",
        },
      ],
      "3": [
        {
          name: "Participating unit number",
          prefix: "PU",
        },
        {
          name: "Link unit line number",
          prefix: "LULN",
        },
      ],
      "4": [
        {
          name: "Track number block",
          prefix: "BLOCK",
        },
        {
          name: "Track number pool",
          prefix: "POOL",
        },
      ],
      "5": [
        {
          name: "Forwarding track number block",
          prefix: "FBLOCK",
        },
      ],
      "6": [
        {
          name: "Link duty",
        },
      ],
    },
    repeatFrom: 6,
  },
  LRUDATA: {
    name: "LINK REPORTING UNIT (RU) DATA",
    fields: {
      "1": [
        {
          name: "Base name",
          prefix: "BASE",
        },
        {
          name: "Place name",
          prefix: "PLACE",
        },
        {
          name: "Task organization commander",
          prefix: "CDR",
        },
        {
          name: "Station designator",
          prefix: "STAT",
        },
        {
          name: "Designation of unit",
          prefix: "UNIT",
        },
        {
          name: "Nadge site designator",
          prefix: "NADGE",
        },
      ],
      "2": [
        {
          name: "Unit call sign",
          prefix: "CS",
        },
        {
          name: "Call sign line number",
          prefix: "CSLN",
        },
      ],
      "3": [
        {
          name: "Reporting unit (ru) number",
          prefix: "RU",
        },
        {
          name: "Link unit line number",
          prefix: "LULN",
        },
      ],
      "4": [
        {
          name: "Track number block",
          prefix: "BLOCK",
        },
      ],
      "5": [
        {
          name: "Forwarding track number block",
          prefix: "FBLOCK",
        },
      ],
      "6": [
        {
          name: "Geographic location, lat/long, seconds",
        },
      ],
      "7": [
        {
          name: "Link duty",
        },
      ],
    },
    repeatFrom: 7,
  },
  LRULINK: {
    name: "LINK REPORTING UNIT (RU) CONNECTIVITY",
    fields: {
      "1": [
        {
          name: "Reporting unit (ru) number",
          prefix: "RUNO",
        },
        {
          name: "Link unit line number",
          prefix: "LULN",
        },
      ],
      "2": [
        {
          name: "Reporting unit (ru) number",
          prefix: "RUNO",
        },
        {
          name: "Link unit line number",
          prefix: "LULN",
        },
      ],
      "3": [
        {
          name: "Link net speed",
        },
      ],
      "4": [
        {
          name: "Type of connectivity",
        },
      ],
      "5": [
        {
          name: "Initialization/reinitialization mode",
        },
      ],
    },
  },
  LSYSDATA: {
    name: "LINK SYSTEM DATA",
    fields: {
      "1": [
        {
          name: "Link 11 net speed",
        },
      ],
      "2": [
        {
          name: "Doppler on or off indicator",
        },
      ],
      "3": [
        {
          name: "Link 11 cryptographic mode",
        },
      ],
      "4": [
        {
          name: "Link-11 wave form",
        },
      ],
    },
  },
  MAIL: {
    name: "MAIL DISTRIBUTION ARRANGEMENTS",
    fields: {
      "1": [
        {
          name: "Timeframe designator",
        },
      ],
      "2": [
        {
          name: "Supplying ship name",
        },
        {
          name: "Unit",
          prefix: "UNIT",
        },
      ],
      "3": [
        {
          name: "Mail delivery method",
        },
      ],
      "4": [
        {
          name: "Ship name",
        },
        {
          name: "Unit",
          prefix: "UNIT",
        },
      ],
    },
  },
  MAP: {
    name: "MAP DATA INFORMATION",
    fields: {
      "1": [
        {
          name: "Map or chart series designator",
        },
      ],
      "2": [
        {
          name: "Map or chart suffix number",
        },
      ],
      "3": [
        {
          name: "Map or chart sheet number",
        },
      ],
      "4": [
        {
          name: "Map or chart edition number",
        },
      ],
      "5": [
        {
          name: "Geodetic datum",
        },
      ],
    },
    repeatFrom: 3,
  },
  MCMABW: {
    name: "MINE COUNTERMEASURE AB WORKSHEET DATA",
    fields: {
      "1": [
        {
          name: "Worksheet mine identification number",
        },
      ],
      "2": [
        {
          name: "Mine name",
        },
      ],
      "3": [
        {
          name: "Worksheet mine type",
        },
      ],
      "4": [
        {
          name: "Underwater mine firing system",
        },
      ],
      "5": [
        {
          name: "Worksheet search or sweep width in yards (a)",
        },
      ],
      "6": [
        {
          name: "Worksheet probability of detection or actuation (b)",
        },
      ],
      "7": [
        {
          name: "Probability of classification",
        },
      ],
      "8": [
        {
          name: "Probability of neutralization",
        },
      ],
      "9": [
        {
          name: "Probability of undetection",
        },
      ],
      "10": [
        {
          name: "Probability of reacquisition of mine",
        },
      ],
      "11": [
        {
          name: "Ab model type",
        },
      ],
      "12": [
        {
          name: "Mine clearance type",
        },
      ],
      "13": [
        {
          name: "Ship count of mine",
        },
      ],
      "14": [
        {
          name: "Arming delay in hours",
        },
      ],
      "15": [
        {
          name: "Deployment date-time group, zulu",
        },
      ],
      "16": [
        {
          name: "Sterilization time in days",
        },
      ],
    },
  },
  MCMPLAN: {
    name: "MINE COUNTERMEASURE PLAN INFORMATION",
    fields: {
      "1": [
        {
          name: "Mine countermeasure plan name",
        },
      ],
      "2": [
        {
          name: "Mine countermeasure plan type",
        },
      ],
      "3": [
        {
          name: "Mine countermeasure plan objective",
        },
      ],
      "4": [
        {
          name: "Mine countermeasure method type",
        },
      ],
      "5": [
        {
          name: "Mine countermeasure plan start date-time group, zulu",
        },
      ],
      "6": [
        {
          name: "Mine countermeasure unit identification",
        },
      ],
      "7": [
        {
          name: "Plan speed, knots",
        },
      ],
      "8": [
        {
          name: "Platform turn time in minutes",
        },
      ],
      "9": [
        {
          name: "Worksheet name",
        },
      ],
      "10": [
        {
          name: "Primary mine number",
        },
      ],
      "11": [
        {
          name: "Desired clearance percentage",
        },
      ],
      "12": [
        {
          name: "Plan navigation error, yards",
          prefix: "YD",
        },
        {
          name: "Plan navigation error, meters",
          prefix: "M",
        },
      ],
      "13": [
        {
          name: "Reference line type",
        },
      ],
      "14": [
        {
          name: "Mine countermeasure task order number",
        },
      ],
    },
  },
  MCMPTRK: {
    name: "MINE COUNTERMEASURE PARALLEL TRACKS",
    fields: {
      "1": [
        {
          name: "Track source",
        },
      ],
      "2": [
        {
          name: "Area and segment",
        },
      ],
      "3": [
        {
          name: "Mine countermeasure area type",
        },
      ],
      "4": [
        {
          name: "Track rotation, relative",
        },
      ],
      "5": [
        {
          name: "Number of runs along track",
        },
      ],
      "6": [
        {
          name: "Track start designator",
        },
      ],
      "7": [
        {
          name: "Mile marker start",
          prefix: "MMKR",
        },
        {
          name: "Start mile marker",
          prefix: "ST",
        },
      ],
      "8": [
        {
          name: "Track end designator",
        },
      ],
      "9": [
        {
          name: "Mile marker end",
          prefix: "MMKR",
        },
        {
          name: "End mile marker",
          prefix: "END",
        },
      ],
      "10": [
        {
          name: "Track offset in yards",
        },
      ],
    },
    repeatFrom: 10,
  },
  MDA: {
    name: "MINE DANGER AREA",
    fields: {
      "1": [
        {
          name: "Mine danger area name",
        },
      ],
      "2": [
        {
          name: "Geographic location, verified lat/long, seconds",
        },
        {
          name: "Location, verified, lat/long, deciseconds",
        },
        {
          name: "Verified true bearing and distance from ref pt",
        },
        {
          name: "Q-ROUTE position",
          prefix: "POSIT",
        },
        {
          name: "Location, verified, lat/long, thousandths of minute",
        },
        {
          name: "Location, UTM 1-meter",
        },
        {
          name: "Geographic location, UTM 10-meter",
        },
        {
          name: "Geographic location, UTM 100-meter",
        },
        {
          name: "Location, UTM 1000-meter",
        },
        {
          name: "Location, georef, minute",
        },
        {
          name: "Location, georef, centiminute",
        },
        {
          name: "Location, abbrev georef, minutes",
        },
        {
          name: "Location, abbrev georef, centiminute",
        },
      ],
      "3": [
        {
          name: "Mine index type",
        },
      ],
    },
    repeatFrom: 2,
  },
  MFLD: {
    name: "MINEFIELD IDENTIFICATION INFORMATION",
    fields: {
      "1": [
        {
          name: "Identification of minefield",
          prefix: "IDCODE",
        },
        {
          name: "Minefield identifier",
        },
      ],
      "2": [
        {
          name: "Classification of mine type",
        },
        {
          name: "Mine mark/mod",
          prefix: "MKMOD",
        },
      ],
      "3": [
        {
          name: "Number of mines to be laid",
        },
      ],
      "4": [
        {
          name: "Geographic location, verified lat/long, seconds",
        },
        {
          name: "Location, verified, lat/long, deciseconds",
        },
        {
          name: "Verified true bearing and distance from ref pt",
        },
        {
          name: "Q-ROUTE position",
          prefix: "POSIT",
        },
        {
          name: "Location, verified, lat/long, thousandths of minute",
        },
        {
          name: "Location, UTM 1-meter",
        },
        {
          name: "Geographic location, UTM 10-meter",
        },
        {
          name: "Geographic location, UTM 100-meter",
        },
        {
          name: "Location, UTM 1000-meter",
        },
        {
          name: "Location, georef, minute",
        },
        {
          name: "Location, georef, centiminute",
        },
        {
          name: "Location, abbrev georef, minutes",
        },
        {
          name: "Location, abbrev georef, centiminute",
        },
      ],
      "5": [
        {
          name: "Verified mine line orientation and spacing",
        },
      ],
      "6": [
        {
          name: "Verified depth in meters or feet",
        },
      ],
      "7": [
        {
          name: "Arming delay in minutes",
        },
        {
          name: "Arming delay in hours and minutes",
        },
        {
          name: "Arming delay in days, hours, and minutes",
        },
      ],
      "8": [
        {
          name: "Count of ships passed",
        },
        {
          name: "Estimated count of ships",
        },
      ],
      "9": [
        {
          name: "Laying reference number (lrn)",
        },
      ],
    },
    repeatFrom: 4,
  },
  MICA: {
    name: "MINE CARGO DESIGNATOR",
    fields: {
      "1": [
        {
          name: "Mine cargo designation number",
        },
      ],
    },
    repeatFrom: 1,
  },
  MINEOPS: {
    name: "MINING OPERATIONS",
    fields: {
      "1": [
        {
          name: "Purpose of minefield",
        },
      ],
      "2": [
        {
          name: "Mining operation",
        },
      ],
      "3": [
        {
          name: "Minefield objective",
        },
      ],
      "4": [
        {
          name: "Minefield target category",
        },
      ],
      "5": [
        {
          name: "Minefield condition and verified time",
        },
      ],
      "6": [
        {
          name: "Air delivery method and vehicle",
        },
        {
          name: "Surface delivery method and vehicle",
        },
        {
          name: "Subsurface delivery method and vehicle",
        },
      ],
      "7": [
        {
          name: "Classification of mine type",
        },
        {
          name: "Mine mark/mod",
        },
      ],
    },
  },
  MIREQNR: {
    name: "MINE REQUISITION NUMBER",
    fields: {
      "1": [
        {
          name: "Mine requisition number",
        },
      ],
    },
  },
  MLORD: {
    name: "MINE LAYING ORDER",
    fields: {
      "1": [
        {
          name: "Mine laying order number",
        },
      ],
    },
  },
  MNOP: {
    name: "MINE COUNTERMEASURE TYPE OF OPERATION",
    fields: {
      "1": [
        {
          name: "Mine operations directive",
        },
      ],
      "2": [
        {
          name: "Enemy threat",
        },
      ],
      "3": [
        {
          name: "Type of mine operation",
        },
      ],
      "4": [
        {
          name: "MCM operation stage number",
        },
      ],
    },
    repeatFrom: 2,
  },
  MREPT: {
    name: "MINE WARFARE REPORT REQUIREMENTS",
    fields: {
      "1": [
        {
          name: "Report modification action",
        },
      ],
      "2": [
        {
          name: "Type of mine warfare report",
        },
        {
          name: "Mine warfare signal code",
          prefix: "CODE",
        },
      ],
      "3": [
        {
          name: "Verified day-time",
        },
        {
          name: "Verified month date-time",
        },
      ],
    },
  },
  MSGID: {
    name: "MESSAGE IDENTIFICATION",
    fields: {
      "1": [
        {
          name: "Message text format identifier",
        },
      ],
      "2": [
        {
          name: "Originator",
        },
      ],
      "3": [
        {
          name: "Message serial number",
        },
      ],
      "4": [
        {
          name: "Month name",
        },
      ],
      "5": [
        {
          name: "Qualifier",
        },
      ],
      "6": [
        {
          name: "Serial number of qualifier",
        },
      ],
    },
  },
  MTASK: {
    name: "MINE COUNTERMEASURE TASK",
    fields: {
      "1": [
        {
          name: "Mine countermeasure task order number",
        },
      ],
      "2": [
        {
          name: "Ship name",
          prefix: "SHIP",
        },
        {
          name: "Tasked unit",
          prefix: "UNIT",
        },
      ],
      "3": [
        {
          name: "Mine countermeasure officer in tactical command (OTC)",
        },
      ],
      "4": [
        {
          name: "Q-ROUTE number",
          prefix: "QNUM",
        },
        {
          name: "Mine countermeasure area name",
          prefix: "AREA",
        },
      ],
      "5": [
        {
          name: "Mine countermeasure task status",
        },
      ],
      "6": [
        {
          name: "Time modifier",
        },
      ],
      "7": [
        {
          name: "Verified day-time",
          prefix: "VTIME",
        },
        {
          name: "Verified month date-time",
          prefix: "VMDT",
        },
        {
          name: "Effective date-time group to seconds",
          prefix: "EFFTIME",
        },
      ],
    },
    repeatFrom: 6,
  },
  MTYPE: {
    name: "TYPE OF MINE",
    fields: {
      "1": [
        {
          name: "Number of mines by type",
        },
      ],
      "2": [
        {
          name: "Mine index type",
        },
      ],
    },
  },
  MULCDUTY: {
    name: "MULTILINK COORDINATOR DUTY",
    fields: {
      "1": [
        {
          name: "Unit",
          prefix: "SHIP",
        },
        {
          name: "Unit call sign",
          prefix: "CS",
        },
        {
          name: "Unit designator",
          prefix: "UNIT",
        },
      ],
      "2": [
        {
          name: "Contact name",
        },
      ],
      "3": [
        {
          name: "Rank or position",
        },
      ],
      "4": [
        {
          name: "Multilink coordination duty",
        },
      ],
      "5": [
        {
          name: "Nonsecure telephone number, international",
          prefix: "TEL",
        },
        {
          name: "Secure telephone number, international",
          prefix: "SECTEL",
        },
        {
          name: "Nonsecure tactical telephone number",
          prefix: "TELTAC",
        },
        {
          name: "Secure tactical telephone number",
          prefix: "SECTAC",
        },
        {
          name: "Specific radio frequency",
          prefix: "FRQ",
        },
        {
          name: "Frequency designator",
          prefix: "FRQDES",
        },
        {
          name: "Electronic mail address",
          prefix: "EMAIL",
        },
        {
          name: "Secure electronic mail address",
          prefix: "SMAIL",
        },
      ],
    },
    repeatFrom: 5,
  },
  NARR: {
    name: "NARRATIVE INFORMATION",
    fields: {
      "1": [
        {
          name: "Free text",
        },
      ],
    },
  },
  NONLDATA: {
    name: "NON-LINK DATA DETAILS",
    fields: {
      "1": [
        {
          name: "Specific call sign",
          prefix: "CS",
        },
        {
          name: "Ship name",
          prefix: "SHIP",
        },
        {
          name: "Base name",
          prefix: "BASE",
        },
        {
          name: "Task organization designator",
          prefix: "NTD",
        },
        {
          name: "Nadge site designator",
          prefix: "NADGE",
        },
      ],
      "2": [
        {
          name: "Link 16 track number block, lower limit",
        },
      ],
      "3": [
        {
          name: "Track number block",
        },
      ],
    },
    repeatFrom: 1,
  },
  NUCAIRFT: {
    name: "NUCLEAR ARMED AIRCRAFT",
    fields: {
      "1": [
        {
          name: "Mission number",
        },
      ],
      "2": [
        {
          name: "Number and type/model of aircraft",
        },
      ],
      "3": [
        {
          name: "Unit name",
          prefix: "UNIT",
        },
        {
          name: "Base name",
          prefix: "BASE",
        },
        {
          name: "Ship name, specific",
        },
      ],
      "4": [
        {
          name: "Verified day-time on station",
        },
      ],
      "5": [
        {
          name: "Verified day-time off station",
        },
      ],
      "6": [
        {
          name: "Alert status, yr/day/hr/min/sec/wk/mon",
        },
      ],
    },
  },
  NUCRLSE: {
    name: "NUCLEAR RELEASE CRITERIA",
    fields: {
      "1": [
        {
          name: "Generic platform type",
        },
      ],
      "2": [
        {
          name: "Operational stand-off range",
        },
      ],
      "3": [
        {
          name: "Emergency stand-off range",
        },
      ],
      "4": [
        {
          name: "Classification and/or confidence level",
        },
      ],
      "5": [
        {
          name: "Time duration in minutes and seconds",
        },
      ],
      "6": [
        {
          name: "Offset",
        },
      ],
      "7": [
        {
          name: "Level indicator",
        },
      ],
      "8": [
        {
          name: "Reported depth",
        },
      ],
      "9": [
        {
          name: "Distance to land",
        },
      ],
      "10": [
        {
          name: "Distance to merchant",
        },
      ],
    },
  },
  NUCTRANS: {
    name: "TRANSFER OF NUCLEAR WEAPONS",
    fields: {
      "1": [
        {
          name: "Supplying ship name",
        },
      ],
      "2": [
        {
          name: "Customer ship name",
        },
      ],
      "3": [
        {
          name: "Verified start day-time",
        },
        {
          name: "Verified month date-time of start",
        },
      ],
    },
  },
  PERIOD: {
    name: "PERIOD OF TIME",
    fields: {
      "1": [
        {
          name: "Start day-time",
        },
        {
          name: "Verified start day-time",
        },
        {
          name: "Day-time and month of start",
        },
        {
          name: "Verified month date-time of start",
        },
        {
          name: "Beginning date-time group",
        },
      ],
      "2": [
        {
          name: "Termination day-time",
        },
        {
          name: "Verified end day-time",
        },
        {
          name: "Day-time and month of stop",
        },
        {
          name: "Verified month date-time of stop",
        },
        {
          name: "Stop time qualifier",
        },
        {
          name: "Ending date-time group",
        },
      ],
      "3": [
        {
          name: "Military day-time",
        },
        {
          name: "Verified day-time",
        },
        {
          name: "Day-time and month",
        },
        {
          name: "Verified month date-time",
        },
        {
          name: "Date-time group",
        },
      ],
    },
  },
  PIM: {
    name: "POSITION AND INTENDED MOVEMENT",
    fields: {
      "1": [
        {
          name: "Location, verified lat/long, minutes",
        },
        {
          name: "Geographic location, verified lat/long, seconds",
        },
        {
          name: "Location, verified, lat/long, deciseconds",
        },
        {
          name: "Verified true bearing and distance from ref pt",
        },
        {
          name: "Q-ROUTE position",
          prefix: "POSIT",
        },
        {
          name: "Location, verified, lat/long, thousandths of minute",
        },
        {
          name: "Location, UTM 1-meter",
        },
        {
          name: "Geographic location, UTM 10-meter",
        },
        {
          name: "Geographic location, UTM 100-meter",
        },
        {
          name: "Location, UTM 1000-meter",
        },
        {
          name: "Location, georef, minute",
        },
        {
          name: "Location, georef, centiminute",
        },
        {
          name: "Location, abbrev georef, minutes",
        },
        {
          name: "Location, abbrev georef, centiminute",
        },
      ],
      "2": [
        {
          name: "Verified day-time of position",
        },
      ],
      "3": [
        {
          name: "Verified course and speed",
        },
        {
          name: "Verified course/speed in knots",
          prefix: "COSPDEC",
        },
      ],
      "4": [
        {
          name: "Verified duration in hours",
        },
        {
          name: "Non discrete indicator",
        },
      ],
    },
    repeatFrom: 3,
  },
  PLANREF: {
    name: "MINE COUNTERMEASURE PLAN REFERENCE LINE",
    fields: {
      "1": [
        {
          name: "Reference line method",
        },
      ],
      "2": [
        {
          name: "Reference line start side number",
        },
      ],
      "3": [
        {
          name: "Reference line end side number",
        },
      ],
      "4": [
        {
          name: "Reference line start position, l/l, ten thousandths, minute",
        },
      ],
      "5": [
        {
          name: "Reference line end position, l/l, ten thousandths of minute",
        },
      ],
      "6": [
        {
          name: "Reference line rotation in relative bearing",
        },
      ],
    },
  },
  POC: {
    name: "POINT OF CONTACT INFORMATION",
    fields: {
      "1": [
        {
          name: "Contact name",
        },
      ],
      "2": [
        {
          name: "Rank or position",
        },
      ],
      "3": [
        {
          name: "Unit identifier",
        },
        {
          name: "Unit call sign",
          prefix: "CALLSIGN",
        },
      ],
      "4": [
        {
          name: "Location name",
        },
        {
          name: "Location, lat/long, seconds",
        },
        {
          name: "Location, UTM 10-meter",
          prefix: "LOC",
        },
      ],
      "5": [
        {
          name: "Nonsecure telephone number",
          prefix: "TEL",
        },
        {
          name: "Secure telephone number",
          prefix: "SECTEL",
        },
        {
          name: "Specific radio frequency",
          prefix: "FRQ",
        },
        {
          name: "Frequency designator",
          prefix: "FRQDES",
        },
        {
          name: "Frequency numeric and mode",
          prefix: "FREQ",
        },
        {
          name: "Electronic mail address",
          prefix: "EMAIL",
        },
      ],
    },
    repeatFrom: 5,
  },
  POLLSEQ: {
    name: "LINK POLLING SEQUENCE",
    fields: {
      "1": [
        {
          name: "Specific call sign",
          prefix: "CALLSIGN",
        },
        {
          name: "Ship name",
        },
        {
          name: "Base name",
          prefix: "BASE",
        },
        {
          name: "Specific ship identification",
        },
        {
          name: "Task organization designator",
        },
        {
          name: "Nadge site designator",
          prefix: "NADGE",
        },
        {
          name: "Interface unit designation",
          prefix: "IUD",
        },
        {
          name: "Participating unit number",
          prefix: "PU",
        },
      ],
    },
    repeatFrom: 1,
  },
  POMOE: {
    name: "PLANNED OVERALL MEASURE OF EFFECTIVENESS",
    fields: {
      "1": [
        {
          name: "Objective of minefield",
        },
      ],
      "2": [
        {
          name: "Name of ship class",
        },
      ],
      "3": [
        {
          name: "Transit speed, knots",
        },
      ],
      "4": [
        {
          name: "Name of ship class",
        },
      ],
      "5": [
        {
          name: "Transit speed, knots",
        },
      ],
      "6": [
        {
          name: "Level of expected countermeasures",
        },
      ],
      "7": [
        {
          name: "Mmoe simple initial threat probability",
        },
      ],
      "8": [
        {
          name: "Average number of casualties",
        },
      ],
      "9": [
        {
          name: "Mmoe sustained threat probability",
        },
      ],
      "10": [
        {
          name: "Planned sustained threat of minefield in days",
        },
      ],
      "11": [
        {
          name: "Expected number of transitors",
        },
      ],
    },
  },
  PROOF: {
    name: "PROOF OF SUCCESS REQUIREMENT",
    fields: {
      "1": [
        {
          name: "Generic platform type",
        },
      ],
      "2": [
        {
          name: "Proof of success indicator",
        },
      ],
    },
    repeatFrom: 1,
  },
  RASKED: {
    name: "REPLENISHMENT AT SEA SCHEDULE",
    fields: {
      "1": [
        {
          name: "Verified day-time of rendezvous",
        },
        {
          name: "Verified month date-time of rendezvous",
        },
      ],
      "2": [
        {
          name: "Geographic location, verified lat/long, seconds",
        },
        {
          name: "Rendezvous position, place name",
          prefix: "N",
        },
        {
          name: "Rendezvous position, bearing/distance from ref pt",
        },
      ],
      "3": [
        {
          name: "Mean line of advance, degrees t/g/m/r",
        },
      ],
      "4": [
        {
          name: "Policy",
        },
      ],
    },
  },
  REF: {
    name: "REFERENCE",
    fields: {
      "1": [
        {
          name: "Serial letter",
        },
      ],
      "2": [
        {
          name: "Message text format identifier",
        },
        {
          name: "Communication type",
        },
      ],
      "3": [
        {
          name: "Originator",
        },
      ],
      "4": [
        {
          name: "Date of reference, year-month-day",
          prefix: "YMD",
        },
        {
          name: "Reference day-time",
        },
        {
          name: "Reference date-time group",
        },
        {
          name: "Date of reference, day-alphamonth-year",
        },
        {
          name: "Day-time and month of reference",
        },
        {
          name: "Verified day-time of reference",
        },
        {
          name: "Verified month date-time of reference",
        },
        {
          name: "Verified date-time group of reference",
        },
        {
          name: "Day-time group of reference",
          prefix: "DTIME",
        },
      ],
      "5": [
        {
          name: "Serial number of reference",
        },
      ],
      "6": [
        {
          name: "Special notation",
        },
      ],
      "7": [
        {
          name: "SIC code",
        },
        {
          name: "Filing number",
        },
      ],
    },
    repeatFrom: 7,
  },
  RNDZVOUS: {
    name: "RENDEZVOUS INSTRUCTIONS",
    fields: {
      "1": [
        {
          name: "Verified day-time of rendezvous",
        },
        {
          name: "Verified date-time group",
        },
        {
          name: "Verified month date-time",
        },
        {
          name: "Day-time and month",
        },
      ],
      "2": [
        {
          name: "Rendezvous position, verified lat/long, minutes",
        },
        {
          name: "Rendezvous position, lat/long, minutes",
        },
        {
          name: "Rendezvous position, place name",
          prefix: "NAME",
        },
        {
          name: "Rendezvous position, bearing/distance from ref pt",
        },
      ],
      "3": [
        {
          name: "Name of ship being joined",
        },
        {
          name: "Task designator of unit being joined",
          prefix: "NTD",
        },
      ],
      "4": [
        {
          name: "Name of joining ship",
        },
        {
          name: "Task designator of unit joining",
          prefix: "NTD",
        },
      ],
      "5": [
        {
          name: "Flight level, qualified",
        },
        {
          name: "Altitude, qualified",
        },
      ],
    },
    repeatFrom: 3,
  },
  SAIL: {
    name: "SAILING INFORMATION",
    fields: {
      "1": [
        {
          name: "Verified day-time of arrival",
        },
        {
          name: "Verified month date-time of arrival",
        },
      ],
      "2": [
        {
          name: "Location, verified lat/long, minutes",
        },
        {
          name: "Place name",
          prefix: "PLACE",
        },
        {
          name: "Geographic location, verified lat/long, seconds",
        },
        {
          name: "Location, verified, lat/long, deciseconds",
        },
        {
          name: "Verified true bearing and distance from ref pt",
        },
        {
          name: "Q-ROUTE position",
          prefix: "POSIT",
        },
      ],
      "3": [
        {
          name: "Verified day-time of departure",
        },
        {
          name: "Verified month date-time of departure",
        },
      ],
    },
  },
  SATINFOJ: {
    name: "LINK-16 SATELLITE INFORMATION",
    fields: {
      "1": [
        {
          name: "Uhf follow-on (ufo) satellite number",
        },
      ],
      "2": [
        {
          name: "Communications satellite channel",
        },
      ],
      "3": [
        {
          name: "Uplink radio frequency",
        },
      ],
      "4": [
        {
          name: "Satellite offset indicator",
        },
      ],
    },
  },
  SHIPDATA: {
    name: "SHIP DATA",
    fields: {
      "1": [
        {
          name: "Nationality",
        },
      ],
      "2": [
        {
          name: "Surface ship type",
        },
      ],
      "3": [
        {
          name: "Ship name",
        },
      ],
      "4": [
        {
          name: "International radio call sign",
        },
      ],
    },
  },
  SPECTRK: {
    name: "SPECIAL TRACK NUMBER",
    fields: {
      "1": [
        {
          name: "Link-11 track number",
          prefix: "LXI",
        },
        {
          name: "Link-11b track number",
          prefix: "LXIB",
        },
        {
          name: "Link-16 track number reference",
          prefix: "LXVI",
        },
      ],
      "2": [
        {
          name: "Special track number description",
        },
      ],
    },
  },
  STATION: {
    name: "SHIPBOARD STATION",
    fields: {
      "1": [
        {
          name: "Ship name",
        },
      ],
      "2": [
        {
          name: "Station assignment name",
        },
      ],
    },
    repeatFrom: 1,
  },
  TACOM: {
    name: "TACTICAL COMMAND",
    fields: {
      "1": [
        {
          name: "Tactical command authority",
        },
      ],
      "2": [
        {
          name: "Verified month date-time of change",
        },
      ],
    },
  },
  THRPRI: {
    name: "THREAT ASSESSMENT IN ORDER OF PRIORITY",
    fields: {
      "1": [
        {
          name: "Enemy weapon",
        },
      ],
    },
    repeatFrom: 1,
  },
  TMDVAR: {
    name: "LINK-16 THEATER MISSILE DEFENSE",
    fields: {
      "1": [
        {
          name: "Track quality delta time in seconds",
        },
      ],
      "2": [
        {
          name: "Track quality lost track subtraction parameter",
        },
      ],
    },
  },
  TRINST: {
    name: "TRANSIT INSTRUCTIONS (MCM)",
    fields: {
      "1": [
        {
          name: "Passage designator",
        },
      ],
      "2": [
        {
          name: "Verified day-time of transit start",
        },
      ],
      "3": [
        {
          name: "Recommended transit speed",
        },
      ],
      "4": [
        {
          name: "Verified ship transit longitudinal interval",
        },
      ],
      "5": [
        {
          name: "Verified group transit longitudinal interval",
        },
      ],
      "6": [
        {
          name: "Name of lead ship in group",
        },
      ],
      "7": [
        {
          name: "Number of ships in group",
        },
      ],
    },
    repeatFrom: 6,
  },
  UNITFLTR: {
    name: "UNIT FILTER DETAILS",
    fields: {
      "1": [
        {
          name: "Filter identifier number",
        },
      ],
      "2": [
        {
          name: "Filter region",
        },
      ],
      "3": [
        {
          name: "Link-16 filter management number",
        },
      ],
      "4": [
        {
          name: "Area filter status",
        },
      ],
      "5": [
        {
          name: "Position designator",
          prefix: "APD",
        },
        {
          name: "Network participant identifier sequence number",
          prefix: "NPI",
        },
      ],
      "6": [
        {
          name: "Environmental category filter",
        },
      ],
      "7": [
        {
          name: "Identification filter",
        },
      ],
      "8": [
        {
          name: "Special filter",
        },
      ],
    },
    repeatFrom: 6,
  },
  VERTINST: {
    name: "VERTICAL REPLENISHMENT INSTRUCTIONS",
    fields: {
      "1": [
        {
          name: "Ship name to provide helos",
        },
      ],
      "2": [
        {
          name: "Helicopter number and type",
        },
      ],
      "3": [
        {
          name: "Ship name of agency assuming control",
        },
      ],
      "4": [
        {
          name: "Diversion position name",
        },
      ],
      "5": [
        {
          name: "Ship name to provide helos fueling capacity",
        },
      ],
    },
  },
  VESC: {
    name: "VESSEL OR CONVOY ESTIMATED TIME OF ARRIVAL",
    fields: {
      "1": [
        {
          name: "Ship name",
        },
        {
          name: "Task organization designator",
        },
        {
          name: "Convoy identifier",
        },
      ],
      "2": [
        {
          name: "Number of ships",
        },
      ],
      "3": [
        {
          name: "Geographic location, verified lat/long, seconds",
        },
        {
          name: "Location, verified, lat/long, deciseconds",
        },
        {
          name: "Verified true bearing and distance from ref pt",
        },
        {
          name: "Q-ROUTE position",
          prefix: "POSIT",
        },
        {
          name: "Location, verified, lat/long, thousandths of minute",
        },
        {
          name: "Location, UTM 1-meter",
        },
        {
          name: "Geographic location, UTM 10-meter",
        },
        {
          name: "Geographic location, UTM 100-meter",
        },
        {
          name: "Location, UTM 1000-meter",
        },
        {
          name: "Location, georef, minute",
        },
        {
          name: "Location, georef, centiminute",
        },
        {
          name: "Location, abbrev georef, minutes",
        },
        {
          name: "Location, abbrev georef, centiminute",
        },
      ],
      "4": [
        {
          name: "Verified day-time",
        },
        {
          name: "Verified month date-time",
        },
      ],
      "5": [
        {
          name: "Lead through instructions",
        },
      ],
    },
  },
  EXER: {
    name: "EXERCISE IDENTIFICATION",
    fields: {
      "1": [
        {
          name: "Exercise nickname",
        },
      ],
      "2": [
        {
          name: "Exercise message additional identifier",
        },
      ],
    },
  },
  OPER: {
    name: "OPERATION IDENTIFICATION DATA",
    fields: {
      "1": [
        {
          name: "Operation codeword",
        },
      ],
      "2": [
        {
          name: "Plan originator and number",
        },
      ],
      "3": [
        {
          name: "Option nickname",
        },
      ],
      "4": [
        {
          name: "Secondary option nickname",
        },
      ],
    },
  },
};
