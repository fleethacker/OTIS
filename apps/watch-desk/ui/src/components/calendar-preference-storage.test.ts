import { expect, test } from "bun:test";
import {
  createCalendarPreferenceStorage,
  DEFAULT_CALENDAR_PREFERENCES,
  sanitizeCalendarPreferences,
  type CalendarPreferences,
} from "./calendar-preference-storage";

test("calendar preferences contain only validated UI configuration and default every disclosure closed", () => {
  expect(sanitizeCalendarPreferences(null)).toEqual(DEFAULT_CALENDAR_PREFERENCES);
  const saved = sanitizeCalendarPreferences({
    view: "month", interval: "30", shipLayout: "side", layout: "expanded",
    ships: '["unit:unknown","unassigned:","unit:unknown"]',
    shipsOpen: true, reviewOpen: true, turnoverOpen: false,
    dayHourHeight: 120, weekHourHeight: 64.5,
    turnoverChoice: "2008-04-01T08:00:00.123Z",
    date: "2008-04-01", query: "source text", rawMessage: "source text", token: "not-a-token",
  });
  expect(saved).toEqual({
    view: "month", interval: "30", shipLayout: "side", layout: "expanded",
    ships: '["unassigned:","unit:unknown"]',
    shipsOpen: true, turnoverOpen: false,
    dayHourHeight: 120, weekHourHeight: 64.5,
    turnoverChoice: "2008-04-01T08:00:00.123Z",
  });
  expect(sanitizeCalendarPreferences({
    view: "agenda", interval: 30, shipLayout: "unknown", layout: "unknown",
    shipsOpen: "true", reviewOpen: 1, turnoverOpen: {},
    dayHourHeight: Number.NaN, weekHourHeight: Infinity,
    turnoverChoice: "2026-02-30T08:00:00Z",
  })).toEqual(DEFAULT_CALENDAR_PREFERENCES);
  for (const value of [0, -1, 4097]) {
    expect(sanitizeCalendarPreferences({ dayHourHeight: value }).dayHourHeight).toBeNull();
  }
});

test("saved ship selection preserves Defaults, All, None and unknown IDs without broadening invalid input", () => {
  for (const value of [null, "all", "[]", '["unit:unknown"]']) {
    expect(sanitizeCalendarPreferences({ ships: value }).ships).toBe(value);
  }
  for (const value of ["broken", {}, ["unit:unknown"], "[1]", "x".repeat(32769), JSON.stringify(Array.from({ length: 65 }, (_, i) => `unit:${i}`))]) {
    expect(sanitizeCalendarPreferences({ ships: value }).ships).toBe('["invalid-selection:"]');
  }
});

function fakeRequest<T>() {
  let result: T;
  const request = { onsuccess: null, onerror: null, get result() { return result; }, error: null } as unknown as IDBRequest<T>;
  return {
    request,
    succeed(value: T) {
      result = value;
      request.onsuccess?.call(request, new Event("success"));
    },
  };
}

/** Controlled transactions exercise completion ordering and failure recovery. */
function fakeDatabase() {
  const records = new Map<IDBValidKey, unknown>();
  const commits: (() => void)[] = [];
  const opens: ReturnType<typeof fakeRequest<IDBDatabase>>[] = [];
  let holdOpen = false;
  let holdTransactions = false;
  let closes = 0;
  let aborts = 0;
  const db = {
    onversionchange: null,
    close() { closes += 1; },
    objectStoreNames: { contains: () => true },
    transaction() {
      let aborted = false;
      const tx = {
        oncomplete: null,
        onabort: null,
        onerror: null,
        error: null,
        abort() {
          aborted = true;
          aborts += 1;
          tx.onabort?.call(tx, new Event("abort"));
        },
        objectStore() {
          function operation<T>(run: () => T): IDBRequest<T> {
            const pending = fakeRequest<T>();
            const commit = () => {
              if (aborted) return;
              pending.succeed(run());
              tx.oncomplete?.call(tx, new Event("complete"));
            };
            if (holdTransactions) commits.push(commit);
            else queueMicrotask(commit);
            return pending.request;
          }
          return {
            get(key: IDBValidKey) { return operation(() => records.get(key)); },
            put(value: unknown, key: IDBValidKey) {
              return operation(() => { records.set(key, value); return key; });
            },
          };
        },
      } as unknown as IDBTransaction;
      return tx;
    },
  } as unknown as IDBDatabase;
  const factory = {
    open() {
      const pending = fakeRequest<IDBDatabase>();
      opens.push(pending);
      if (!holdOpen) queueMicrotask(() => pending.succeed(db));
      return pending.request as IDBOpenDBRequest;
    },
  } as unknown as IDBFactory;
  return {
    records, commits, opens, db, factory,
    get closes() { return closes; },
    get aborts() { return aborts; },
    holdOpen(value: boolean) { holdOpen = value; },
    holdTransactions(value: boolean) { holdTransactions = value; },
  };
}

const nextTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

test("IndexedDB settings stay scoped, are versioned, and serialize snapshots until commit", async () => {
  const fake = fakeDatabase();
  const storage = createCalendarPreferenceStorage({ factory: () => fake.factory });
  expect(await storage.read("alice")).toBeUndefined();
  fake.holdTransactions(true);
  const preferences: CalendarPreferences = { ...DEFAULT_CALENDAR_PREFERENCES, view: "week" };
  let committed = false;
  const first = storage.write("alice", preferences).then(() => { committed = true; });
  const last = storage.write("alice", { ...preferences, shipsOpen: true });
  preferences.view = "day";
  await nextTask();
  expect(fake.commits.length).toBe(1);
  expect(committed).toBe(false);
  fake.commits.shift()!();
  await first;
  await nextTask();
  expect(fake.commits.length).toBe(1);
  fake.commits.shift()!();
  await last;
  fake.holdTransactions(false);
  expect(await storage.read("alice")).toMatchObject({ view: "week", shipsOpen: true });
  expect(await storage.read("bob")).toBeUndefined();
  expect(fake.records.get("alice")).toEqual({ version: 1, preferences: { ...DEFAULT_CALENDAR_PREFERENCES, view: "week", shipsOpen: true } });
  fake.records.set("bob", { version: 2, preferences: { view: "month" } });
  expect(await storage.read("bob")).toBeUndefined();
  expect(fake.opens.length).toBe(1);
  fake.db.onversionchange?.call(fake.db, new Event("versionchange") as IDBVersionChangeEvent);
  expect(fake.closes).toBe(1);
  expect(await storage.read("alice")).toMatchObject({ view: "week" });
  expect(fake.opens.length).toBe(2);
});

test("missing, denied and blocked browser storage reject without hanging and close late connections", async () => {
  await expect(createCalendarPreferenceStorage({ factory: () => undefined }).read("alice")).rejects.toThrow("unavailable");
  await expect(createCalendarPreferenceStorage({ factory: () => { throw new Error("denied"); } }).read("alice")).rejects.toThrow("denied");
  const fake = fakeDatabase();
  fake.holdOpen(true);
  const storage = createCalendarPreferenceStorage({ factory: () => fake.factory });
  const pending = storage.read("alice");
  await nextTask();
  const request = fake.opens[0]!.request as IDBOpenDBRequest;
  request.onblocked?.call(request, new Event("blocked") as IDBVersionChangeEvent);
  await expect(pending).rejects.toThrow("blocked");
  fake.opens[0]!.succeed(fake.db);
  expect(fake.closes).toBe(1);
  fake.holdOpen(false);
  expect(await storage.read("alice")).toBeUndefined();
});

test("open and transaction deadlines recover without allowing a late write", async () => {
  const fake = fakeDatabase();
  fake.holdOpen(true);
  const storage = createCalendarPreferenceStorage({ factory: () => fake.factory, timeoutMs: 10 });
  await expect(storage.read("alice")).rejects.toThrow("timed out");
  fake.opens[0]!.succeed(fake.db);
  expect(fake.closes).toBe(1);
  fake.holdOpen(false);
  fake.holdTransactions(true);
  await expect(storage.write("alice", { ...DEFAULT_CALENDAR_PREFERENCES, view: "month" })).rejects.toThrow("timed out");
  expect(fake.aborts).toBe(1);
  fake.commits.shift()!();
  fake.holdTransactions(false);
  expect(await storage.read("alice")).toBeUndefined();
  await storage.write("alice", { ...DEFAULT_CALENDAR_PREFERENCES, view: "week" });
  expect(await storage.read("alice")).toMatchObject({ view: "week" });
});
