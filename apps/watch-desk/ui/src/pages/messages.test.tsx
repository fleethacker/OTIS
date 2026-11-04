import "../route-registry";
import { expect, test } from "bun:test";
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { fireEvent, within } from "@testing-library/react";
import { renderWithProviders } from "../test-utils/render";
import { MessageRecordSchema } from "../gen/app/v1/models_pb";
import { MessageReader } from "../components/message-reader";
import { messageTitle, structuredIdentifiers } from "../components/structured-message-format";
import Messages from "./messages";

// The larger project keeps the reference corpus outside Git and Docker images.
// Generic reader tests below always run; only corpus-specific cases are optional.
const referenceFile = Bun.file(
  new URL("../../../internal/service/testdata/structured-messages.json", import.meta.url)
);
const hasExternalReferences = await referenceFile.exists();
const structuredMessages: { id: string; name: string; purpose: string; text: string }[] =
  hasExternalReferences ? await referenceFile.json() : [];

test("message page mounts truthful loading and keyboard search", () => {
  const view = renderWithProviders(<Messages />, { route: "/messages?record=missing" });
  expect(view.getByRole("searchbox", { name: "Search Message records" })).toBeTruthy();
  expect(view.getByRole("status").textContent).toContain("Loading");
  expect(view.queryByRole("combobox", { name: "Search mode" })).toBeNull();
  expect(view.queryByRole("combobox", { name: "Dataset" })).toBeNull();
});
test("reader preserves missing information and switches views", () => {
  const message = create(MessageRecordSchema, {
    sourceMessageId: "test-source",
    provenance: "fictional",
    rawText: "Illustrative line",
    events: [{ title: "Unresolved activity", scheduleStatus: "needs_review" }],
  });
  const view = renderWithProviders(<MessageReader message={message} />);
  expect(view.getByText(/Fictional USS Meridian/)).toBeTruthy();
  expect(view.getByRole("button", { name: "Summarize" }).hasAttribute("disabled")).toBe(true);
  expect(view.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
    "Parsed fields",
    "Raw message",
    "Lifecycle",
  ]);
  expect(view.getByRole("tab", { name: "Raw message" }).getAttribute("aria-selected")).toBe(
    "false"
  );
  expect(view.getByRole("tab", { name: "Parsed fields" }).getAttribute("aria-selected")).toBe(
    "true"
  );
  expect(view.getByText(/Needs review/)).toBeTruthy();
  expect(view.getAllByText("Unavailable").length).toBeGreaterThan(0);
  fireEvent.click(view.getByRole("tab", { name: "Raw message" }));
  expect(view.getByRole("tab", { name: "Raw message" }).getAttribute("aria-selected")).toBe("true");
  expect(view.getByRole("tab", { name: "Parsed fields" }).getAttribute("aria-selected")).toBe(
    "false"
  );
  expect(view.getByText("Illustrative line")).toBeTruthy();
});

test("reader tabs use roving focus and associated panels", () => {
  const view = renderWithProviders(<MessageReader message={create(MessageRecordSchema)} />);
  const tabs = view.getAllByRole("tab");
  const select = (index: number) => {
    for (const [i, tab] of tabs.entries()) {
      expect(tab.getAttribute("aria-selected")).toBe(String(i === index));
      expect(tab.tabIndex).toBe(i === index ? 0 : -1);
    }
    const panel = view.getByRole("tabpanel");
    expect(panel.id).toBe(tabs[index].getAttribute("aria-controls")!);
    expect(panel.getAttribute("aria-labelledby")).toBe(tabs[index].id);
  };
  select(0);
  tabs[0].focus();
  for (const [key, index] of [
    ["ArrowRight", 1],
    ["ArrowRight", 2],
    ["ArrowRight", 0],
    ["ArrowLeft", 2],
    ["Home", 0],
    ["End", 2],
  ] as const) {
    fireEvent.keyDown(document.activeElement!, { key });
    select(index);
    expect(document.activeElement).toBe(tabs[index]);
  }
});

test("lifecycle renders supplied repeated milestones, UTC boundaries and unavailable time", () => {
  const at = (value: string) => timestampFromDate(new Date(value));
  const message = create(MessageRecordSchema, {
    sourceMessageId: "fictional-history",
    processingStatus: "updated",
    lifecycleEntries: [
      {
        id: "first",
        milestone: "parsed",
        recordedAt: at("2026-11-04T23:59:00Z"),
        detail: "First fictional parse",
        provenance: "fictional",
      },
      {
        id: "again",
        milestone: "parsed",
        recordedAt: at("2026-11-05T00:00:00Z"),
        detail: "Repeated fictional parse",
      },
      { id: "review", milestone: "reviewed", detail: "Undated fictional review" },
    ],
  });
  const view = renderWithProviders(<MessageReader message={message} />);
  fireEvent.click(view.getByRole("tab", { name: "Lifecycle" }));
  const panel = view.getByRole("tabpanel");
  expect(panel.textContent).toContain("2026-11-04 23:59 UTC");
  expect(panel.textContent).toContain("2026-11-05 00:00 UTC");
  expect(panel.textContent).toMatch(/time unavailable/i);
  expect(panel.textContent!.indexOf("First fictional parse")).toBeLessThan(
    panel.textContent!.indexOf("Repeated fictional parse")
  );
  expect(panel.textContent).toContain("Undated fictional review");
  expect(panel.textContent).not.toMatch(/Acknowledged/);
});

test("absent lifecycle remains unavailable rather than inferred from processing status", () => {
  const view = renderWithProviders(
    <MessageReader message={create(MessageRecordSchema, { processingStatus: "parsed" })} />
  );
  fireEvent.click(view.getByRole("tab", { name: "Lifecycle" }));
  const panel = view.getByRole("tabpanel");
  expect(panel.textContent).toMatch(/unavailable/i);
  expect(panel.querySelectorAll("time").length).toBe(0);
  expect(panel.textContent).not.toMatch(/Acknowledged/);
});

test.skipIf(!hasExternalReferences)(
  "structured fixture corpus contains all 14 reference cases (optional external corpus)",
  () => {
    expect(structuredMessages).toHaveLength(14);
    expect(new Set(structuredMessages.map((fixture) => fixture.id)).size).toBe(14);
  }
);

for (const fixture of structuredMessages) {
  test(`reader renders structured reference ${fixture.name}`, () => {
    const payload = JSON.parse(fixture.text);
    const message = create(MessageRecordSchema, {
      sourceMessageId: fixture.id,
      structuredPayloadJson: fixture.text,
      provenance: fixture.purpose,
      referenceAttribution: fixture.name,
    });
    const view = renderWithProviders(<MessageReader message={message} />);
    const panel = within(view.getByRole("tabpanel"));
    expect(view.getByRole("heading", { level: 2 }).textContent).toBe(
      payload.serial ? `${payload.type} · ${payload.serial}` : payload.type
    );
    expect(view.getByText(/Attachment reference/).textContent).toContain(fixture.name);
    expect(view.getByText(/Attachment reference/).textContent).toContain(
      "Not operational data or validated USMTF"
    );
    for (const title of [
      "Message metadata",
      "Security metadata",
      "Review flags",
      "Periods",
      "Frequencies",
      "Activities",
      "Contacts",
    ]) {
      expect(panel.getByRole("region", { name: title })).toBeTruthy();
    }
    expect(panel.getByText(payload.id)).toBeTruthy();
    expect(
      within(panel.getByRole("region", { name: "Message metadata" })).getByText(payload.originator)
    ).toBeTruthy();
    expect(panel.getAllByText("needs_review").length).toBeGreaterThan(0);
    expect(
      panel.getByText(/Periods and activities are not confirmed calendar events/)
    ).toBeTruthy();
    expect(
      panel.getByText(/Security metadata is supplied, not authorization or validated markings/)
    ).toBeTruthy();
    expect(structuredIdentifiers(message)).toBe(
      [
        payload.type,
        payload.originator,
        payload.serial,
        payload.status,
        ...(payload.review_flags ?? []),
      ]
        .filter((value) => typeof value === "string")
        .join(" · ")
    );
    // Every supplied scalar remains visible, including nested activities and contact channels.
    const assertValues = (value: unknown, field = "") => {
      if (value === null) {
        expect(panel.getAllByText("Unavailable (null)").length).toBeGreaterThan(0);
      } else if (Array.isArray(value)) {
        if (!value.length)
          expect(panel.getAllByText("None supplied (empty list)").length).toBeGreaterThan(0);
        for (const item of value) assertValues(item);
      } else if (typeof value === "object") {
        for (const [key, item] of Object.entries(value!)) assertValues(item, key);
      } else if (typeof value === "string" && /^\d{4}-\d\d-\d\dT/.test(value)) {
        expect(view.getByRole("tabpanel").querySelector(`time[datetime="${value}"]`)).toBeTruthy();
      } else {
        const text = `${value}${typeof value === "number" && ["hz", "upper_hz"].includes(field) ? " Hz" : ""}`;
        expect(panel.getAllByText(text).length).toBeGreaterThan(0);
      }
    };
    assertValues(payload);
    if (payload.frequencies.some((frequency: { hz: number | null }) => frequency.hz === 23)) {
      expect(panel.getByText("23 Hz")).toBeTruthy();
      expect(panel.queryByText("23000000 Hz")).toBeNull();
    }
    fireEvent.click(view.getByRole("tab", { name: "Raw message" }));
    expect(view.getByText("Raw message unavailable.")).toBeTruthy();
  });
}

test("title and search helpers prefer structured identifiers and preserve legacy fallbacks", () => {
  const message = create(MessageRecordSchema, {
    subject: "Legacy subject",
    events: [{ title: "Legacy event" }],
    structuredPayloadJson: JSON.stringify({
      subject: "Source subject",
      type: "OPTASK",
      serial: "0000",
    }),
  });
  expect(messageTitle(message)).toBe("Source subject");
  message.structuredPayloadJson = JSON.stringify({ subject: "  ", type: "OPTASK", serial: "0000" });
  expect(messageTitle(message)).toBe("OPTASK · 0000");
  message.structuredPayloadJson = "{}";
  expect(messageTitle(message)).toBe("Message type unavailable");
  for (const invalid of ["{", "null", "[]", '"text"']) {
    message.structuredPayloadJson = invalid;
    expect(messageTitle(message)).toBe("Legacy subject");
    expect(structuredIdentifiers(message)).toBe("");
    const view = renderWithProviders(<MessageReader message={message} />);
    expect(view.getByRole("alert").textContent).toContain(
      "Structured payload unavailable or invalid"
    );
    expect(view.getByText("Legacy event")).toBeTruthy();
    view.unmount();
  }
  message.structuredPayloadJson = undefined;
  message.subject = undefined;
  expect(messageTitle(message)).toBe("Legacy event");
  message.events = [];
  expect(messageTitle(message)).toBe("Subject unavailable");
});

test("reader preserves recursive additional fields and distinct empty and falsy values", () => {
  const view = renderWithProviders(
    <MessageReader
      message={create(MessageRecordSchema, {
        provenance: "reference",
        referenceAttribution: "Extensibility test",
        structuredPayloadJson: JSON.stringify({
          subject: null,
          command_ids: [],
          security: { extension: { nested: [{ leaf: "Deep security value" }] } },
          activities: [
            {
              type: "future_activity",
              extension: { enabled: false, count: 0, blank: "", object: {} },
            },
          ],
          future_root: { items: [{ leaf: "Deep root value" }] },
        }),
      })}
    />
  );
  const panel = within(view.getByRole("tabpanel"));
  expect(
    panel.getAllByRole("heading", { name: "Additional fields" }).length
  ).toBeGreaterThanOrEqual(5);
  for (const text of [
    "Unavailable (null)",
    "None supplied (empty list)",
    "Not supplied",
    "false",
    "0",
    'Empty string ("")',
    "Empty object",
    "Deep security value",
    "Deep root value",
    "future_activity",
  ]) {
    expect(panel.getAllByText(text).length).toBeGreaterThan(0);
  }
  expect(
    within(panel.getByRole("region", { name: "Message metadata" })).getByText("Unavailable (null)")
  ).toBeTruthy();
  expect(
    within(panel.getByRole("region", { name: "Periods" })).getByText("Not supplied")
  ).toBeTruthy();
});

test("reader keeps uncertain time fragments literal and escapes source HTML", () => {
  const html = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
  const view = renderWithProviders(
    <MessageReader
      message={create(MessageRecordSchema, {
        provenance: "reference",
        referenceAttribution: html,
        structuredPayloadJson: JSON.stringify({
          subject: html,
          issued_at: "2026-11-04T23:59:00Z",
          periods: [{ end_status: "open_ended" }],
          activities: [
            { time: "23:45Z", time_status: "missing_date", status: "inferred" },
            {
              as_of_time: "12:00",
              as_of_status: "missing_date_and_zone",
              deadline_label: "AS REQD",
              deadline_status: "condition_not_scheduled",
            },
            { time: "23:00Z", time_status: "missing_month_and_year", description: html },
          ],
          review_flags: ["time_conflict", "marking_unresolved"],
        }),
      })}
    />
  );
  const panel = within(view.getByRole("tabpanel"));
  for (const text of [
    "23:45Z",
    "12:00",
    "AS REQD",
    "23:00Z",
    "open_ended",
    "missing_date",
    "missing_date_and_zone",
    "condition_not_scheduled",
    "missing_month_and_year",
    "inferred",
    "time_conflict",
    "marking_unresolved",
  ]) {
    const element = panel.getByText(text);
    expect(element.closest("time")).toBeNull();
  }
  expect(view.getByRole("tabpanel").querySelectorAll("time").length).toBe(1);
  expect(panel.getAllByText(html)).toHaveLength(2);
  expect(view.getByRole("heading", { level: 2 }).textContent).toBe(html);
  expect(view.container.querySelector("img, script")).toBeNull();
});
