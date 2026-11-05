import { expect, test } from "bun:test";
import { messageSearchState } from "./message-search-state";

test("search filters use source originator and inclusive Zulu dates across calendar boundaries", () => {
  const params = new URLSearchParams({
    messageType: "OPTASK COMMS",
    sender: "TRAINING COMMAND",
    fromDate: "2008-03-31",
    throughDate: "2008-04-01",
    sort: "issued_asc",
  });
  const state = messageSearchState(params, "communications", "opaque");
  expect(state.error).toBeUndefined();
  expect(state.activeFilters).toBe(3);
  expect(state.request).toEqual({
    query: "communications",
    mode: "hybrid",
    dataset: "canonical",
    sort: "issued_asc",
    pageToken: "opaque",
    filters: {
      messageTypes: ["OPTASK COMMS"],
      originators: ["TRAINING COMMAND"],
      issuedFrom: "2008-03-31T00:00:00.000Z",
      issuedTo: "2008-04-02T00:00:00.000Z",
    },
  });
});
test("invalid or reversed dates block search and default sorting follows query context", () => {
  for (const fields of [
    { fromDate: "2008-02-30" },
    { fromDate: "2008-04-02", throughDate: "2008-04-01" },
  ]) {
    expect(messageSearchState(new URLSearchParams(fields), "").error).toBeDefined();
  }
  expect(messageSearchState(new URLSearchParams(), "").sort).toBe("issued_desc");
  expect(messageSearchState(new URLSearchParams(), "comms").sort).toBe("relevance");
});

test("CASREP filters survive URL state and become exact metadata filters", () => {
  const state = messageSearchState(
    new URLSearchParams({
      messageType: "CASREP",
      casualtySerial: "2026001",
      casualtyUic: "N54321",
      casualtyCategory: "2",
      casualtyReportType: "UPDATE",
    }),
    "radar"
  );
  expect(state.activeFilters).toBe(5);
  expect(state.request.filters).toEqual({
    messageTypes: ["CASREP"],
    casualtySerials: ["2026001"],
    casualtyUics: ["N54321"],
    casualtyCategories: ["2"],
    casualtyReportTypes: ["UPDATE"],
  });
});
