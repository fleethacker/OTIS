export interface CalendarPreferences {
  view: "day" | "week" | "month";
  interval: "30" | "60";
  shipLayout: "combined" | "side";
  layout: "fit" | "expanded";
  /** null follows shared defaults; explicit All/None/unknown keys remain distinct. */
  ships: string | null;
  shipsOpen: boolean;
  turnoverOpen: boolean;
  dayHourHeight: number | null;
  weekHourHeight: number | null;
  turnoverChoice: string;
}

export const DEFAULT_CALENDAR_PREFERENCES: Readonly<CalendarPreferences> = Object.freeze({
  view: "day",
  interval: "60",
  shipLayout: "combined",
  layout: "fit",
  ships: null,
  shipsOpen: false,
  turnoverOpen: false,
  dayHourHeight: null,
  weekHourHeight: null,
  turnoverChoice: "auto",
});

const INVALID_SHIPS = '["invalid-selection:"]';
const DATABASE = "otis-ui-preferences";
const STORE = "calendar";

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function ships(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (value === "all") return value;
  if (typeof value !== "string" || value.length > 32768) return INVALID_SHIPS;
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed) && parsed.length <= 64 &&
        parsed.every((key) => typeof key === "string" && key.length <= 512)) {
      return JSON.stringify([...new Set(parsed)].sort());
    }
  } catch {
    // Corrupt explicit selection must not silently become All/shared defaults.
  }
  return INVALID_SHIPS;
}

function hourHeight(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 4096
    ? value : null;
}

function turnoverChoice(value: unknown): string {
  if (value === "auto") return value;
  if (typeof value !== "string" || value.length > 24 ||
      !/^(?!0000)\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?Z$/.test(value)) return "auto";
  const instant = Date.parse(value);
  if (!Number.isFinite(instant) || new Date(instant).toISOString().slice(0, 10) !== value.slice(0, 10)) return "auto";
  // Keep old pinned boundaries. The calendar reports expired windows explicitly.
  return value;
}

/** Only allowlisted display settings enter the browser database. */
export function sanitizeCalendarPreferences(value: unknown): CalendarPreferences {
  const input = object(value) ? value : {};
  return {
    view: input.view === "week" || input.view === "month" ? input.view : "day",
    interval: input.interval === "30" ? "30" : "60",
    shipLayout: input.shipLayout === "side" ? "side" : "combined",
    layout: input.layout === "expanded" ? "expanded" : "fit",
    ships: ships(input.ships),
    shipsOpen: input.shipsOpen === true,
    turnoverOpen: input.turnoverOpen === true,
    dayHourHeight: hourHeight(input.dayHourHeight),
    weekHourHeight: hourHeight(input.weekHourHeight),
    turnoverChoice: turnoverChoice(input.turnoverChoice),
  };
}

export interface CalendarPreferenceStorage {
  read(scope: string): Promise<CalendarPreferences | undefined>;
  write(scope: string, value: CalendarPreferences): Promise<void>;
}

/** Native IndexedDB; callers can keep working in memory when storage is unavailable. */
export function createCalendarPreferenceStorage({
  factory = () => globalThis.indexedDB,
  timeoutMs = 2000,
}: {
  factory?: () => IDBFactory | undefined;
  timeoutMs?: number;
} = {}): CalendarPreferenceStorage {
  let connection: IDBDatabase | undefined;
  let opening: Promise<IDBDatabase> | undefined;
  let writes: Promise<void> = Promise.resolve();
  const deadline = Number.isFinite(timeoutMs) ? Math.max(1, Math.min(timeoutMs, 2000)) : 2000;

  function disconnect(database: IDBDatabase) {
    if (connection === database) connection = undefined;
    database.close();
  }

  function database(): Promise<IDBDatabase> {
    if (connection) return Promise.resolve(connection);
    if (opening) return opening;
    const attempt = new Promise<IDBDatabase>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => fail(new Error("Calendar preference storage timed out")), deadline);
      function fail(error: unknown) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      }
      try {
        const indexedDB = factory();
        if (!indexedDB) throw new Error("Calendar preference storage unavailable");
        const request = indexedDB.open(DATABASE, 1);
        request.onblocked = () => fail(new Error("Calendar preference storage blocked"));
        request.onerror = () => fail(request.error ?? new Error("Calendar preference storage unavailable"));
        request.onupgradeneeded = () => {
          try {
            if (settled) {
              request.transaction?.abort();
              return;
            }
            const db = request.result;
            if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
          } catch (error) {
            try { request.transaction?.abort(); } catch { /* The upgrade may already be finished. */ }
            fail(error);
          }
        };
        request.onsuccess = () => {
          const db = request.result;
          if (settled) {
            db.close();
            return;
          }
          settled = true;
          clearTimeout(timer);
          db.onversionchange = () => disconnect(db);
          resolve(db);
        };
      } catch (error) {
        fail(error);
      }
    });
    opening = attempt;
    void attempt.then((db) => {
      connection = db;
      if (opening === attempt) opening = undefined;
    }, () => {
      if (opening === attempt) opening = undefined;
    });
    return attempt;
  }

  async function transaction<T>(mode: IDBTransactionMode, operate: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await database();
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      let tx: IDBTransaction | undefined;
      let result: T;
      const timer = setTimeout(() => fail(new Error("Calendar preference transaction timed out")), deadline);
      function fail(error: unknown) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try { tx?.abort(); } catch { /* The transaction may already be finished. */ }
        disconnect(db);
        reject(error);
      }
      try {
        tx = db.transaction(STORE, mode);
        tx.onabort = () => fail(tx?.error ?? new Error("Calendar preference transaction aborted"));
        tx.onerror = () => fail(tx?.error ?? new Error("Calendar preference transaction failed"));
        tx.oncomplete = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(result);
        };
        const request = operate(tx.objectStore(STORE));
        request.onsuccess = () => { result = request.result; };
        request.onerror = () => fail(request.error ?? new Error("Calendar preference request failed"));
      } catch (error) {
        fail(error);
      }
    });
  }

  function assertScope(scope: string) {
    if (typeof scope !== "string" || scope.length === 0 || scope.length > 512) {
      throw new Error("Calendar preference scope unavailable");
    }
  }

  return {
    async read(scope) {
      assertScope(scope);
      await writes;
      const record: unknown = await transaction("readonly", (store) => store.get(scope));
      return object(record) && record.version === 1 && object(record.preferences)
        ? sanitizeCalendarPreferences(record.preferences) : undefined;
    },
    async write(scope, value) {
      assertScope(scope);
      const record = { version: 1, preferences: sanitizeCalendarPreferences(value) };
      const operation = writes.then(async () => {
        await transaction("readwrite", (store) => store.put(record, scope));
      });
      writes = operation.catch(() => undefined);
      await operation;
    },
  };
}

export const calendarPreferenceStorage = createCalendarPreferenceStorage();
