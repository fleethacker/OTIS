import "../route-registry";
import { expect, test } from "bun:test";
import { create } from "@bufbuild/protobuf";
import { fireEvent, within } from "@testing-library/react";
import { renderWithProviders } from "../test-utils/render";
import { MessageRecordSchema } from "../gen/app/v1/models_pb";
import { MessageReader } from "../components/message-reader";
import Messages from "./messages";
import { messageSearchState } from "../components/message-search-state";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRouterTransport } from "@connectrpc/connect";
import { TransportProvider } from "@connectrpc/connect-query";
import { AppService } from "../gen/app/v1/app_pb";
import { DraftService } from "../gen/app/v1/drafts_pb";

test("message page mounts loading and keeps search mode server-owned", () => {
  const view = renderWithProviders(<Messages />, { route: "/messages?record=missing" });
  expect(view.getByRole("searchbox", { name: "Search Message records" })).toBeTruthy();
  expect(view.getByRole("status").textContent).toContain("Loading");
  expect(view.queryByRole("combobox", { name: "Search mode" })).toBeNull();
  expect(view.queryByRole("combobox", { name: "Dataset" })).toBeNull();
});
test("reader uses source-set cards, one review pill and no internal metadata or action sidebar", () => {
  const set = (set_id: string, values: string[]) => ({
    set_id,
    fields: values.map((value, index) => ({ position: index + 1, value })),
    rows: [],
  });
  const view = renderWithProviders(
    <MessageReader
      message={create(MessageRecordSchema, {
        sourceMessageId: "internal-id-hidden",
        processingStatus: "needs_review",
        rawText: "Source text preserved",
        structuredPayloadJson: JSON.stringify({
          subject: "Exercise tasking",
          id: "internal-payload-id",
          revision: "internal-revision",
          review_flags: ["internal_flag"],
          source_profile: "observed-optask-extensions-v1",
          sets: [
            set("MSGID", ["OPTASK EW", "MIL-STD-6040(SERIES)", "B.1.01.12", "EXERCISE GROUP"]),
            set("ESMTASK", ["EXERCISE UNIT", "RECEIVER", "FREQLIM:7.5-12GHZ"]),
            set("GENTEXT", [
              "REPORTING",
              "Keep slash / in narrative and HTTP://example.invalid/path",
            ]),
            set("GENTEXT", ["REPORTING", "Second occurrence"]),
          ],
        }),
        events: [{ scheduleStatus: "needs_review", reviewReason: "internal reason" }],
      })}
    />
  );
  expect(view.getByText("needs review").className).toContain("status-pill");
  expect(view.getByRole("tab", { name: "Parsed Message" })).toBeTruthy();
  expect(view.getByRole("region", { name: "MSGID" })).toBeTruthy();
  expect(view.getByRole("region", { name: "ESMTASK" }).textContent).toContain("FREQLIM:7.5-12GHZ");
  expect(view.getAllByRole("region", { name: "GENTEXT — REPORTING" })).toHaveLength(2);
  expect(view.getByText("Keep slash / in narrative and HTTP://example.invalid/path")).toBeTruthy();
  for (const text of [
    "internal-id-hidden",
    "internal-payload-id",
    "internal-revision",
    "internal_flag",
    "internal reason",
    "Upstream extracted fields",
    "Message actions",
    "Additional fields",
  ])
    expect(view.container.textContent).not.toContain(text);
  fireEvent.click(view.getByRole("tab", { name: "Raw message" }));
  expect(view.getByText("Source text preserved")).toBeTruthy();
});
test("reader tabs preserve keyboard focus and associated panels", () => {
  const view = renderWithProviders(<MessageReader message={create(MessageRecordSchema)} />);
  const tabs = view.getAllByRole("tab");
  tabs[0].focus();
  for (const [key, index] of [
    ["ArrowRight", 1],
    ["ArrowRight", 2],
    ["ArrowLeft", 1],
    ["Home", 0],
    ["End", 2],
  ] as const) {
    fireEvent.keyDown(document.activeElement!, { key });
    expect(tabs[index].getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tabs[index]);
    expect(view.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(tabs[index].id);
  }
});
test("reader escapes source content and never substitutes internal facts for missing sets", () => {
  const html = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
  const view = renderWithProviders(
    <MessageReader
      message={create(MessageRecordSchema, {
        structuredPayloadJson: JSON.stringify({
          subject: html,
          source_profile: "usmtf-2003-subset-v1",
          sets: [
            {
              set_id: "MSGID",
              fields: [
                { position: 1, value: "OPTASK LINK" },
                { position: 2, value: html },
                { position: 3, value: "-" },
              ],
              rows: [],
            },
          ],
          activities: [{ id: "do-not-display", time_status: "missing_date" }],
        }),
      })}
    />
  );
  expect(view.container.querySelector("img, script")).toBeNull();
  expect(view.getAllByText(html)).toHaveLength(2);
  expect(view.getByText("-")).toBeTruthy();
  expect(view.container.textContent).not.toContain("do-not-display");
  expect(view.container.textContent).not.toContain("missing_date");
  view.unmount();
  const missing = renderWithProviders(
    <MessageReader
      message={create(MessageRecordSchema, { structuredPayloadJson: '{"id":"hidden"}' })}
    />
  );
  expect(missing.getByText("Parsed sets unavailable.")).toBeTruthy();
  expect(missing.container.textContent).not.toContain("hidden");
});

test("message search opens a compact reader on selection and closes back to full-width cards", () => {
  const key = "source-card@r1";
  const message = create(MessageRecordSchema, {
    id: 1n,
    sourceMessageId: key,
    subject: "Exercise communications preview",
    sender: "TRAINING COMMAND",
    rawText: "MSGID/OPTASK COMMS//",
  });
  // Seed fresh source reads so this interaction test stays isolated from network
  // and unrelated pending requests in the DOM test environment.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(
    [
      "parse-command-source",
      "search",
      messageSearchState(new URLSearchParams("q=preview"), "preview").request,
    ],
    {
      messages: [message],
      meta: {
        messageHeaders: {
          [key]: {
            type: "OPTASK COMMS",
            originator: "TRAINING COMMAND",
            issuedAt: "2008-03-31T18:00:00Z",
          },
        },
      },
    }
  );
  client.setQueryData(["parse-command-source", "options", { dataset: "canonical" }], {
    messages: [],
    meta: { filterOptions: { messageTypes: ["OPTASK COMMS"], originators: ["TRAINING COMMAND"] } },
  });
  client.setQueryData(["parse-command-source", "detail", { key, dataset: "canonical" }], {
    messages: [message],
    meta: {},
  });
  const transport = createRouterTransport((router) => {
    router.service(AppService, { getIdentity: () => ({ username: "test-user" }) });
    router.service(DraftService, {
      readDraft: () => ({}),
      readPreparation: () => ({ fieldsJson: "{}", historyJson: "[]" }),
    });
  });
  const view = renderWithProviders(
    <TransportProvider transport={transport}>
      <QueryClientProvider client={client}>
        <Messages />
      </QueryClientProvider>
    </TransportProvider>,
    { route: "/messages?q=preview&returnTo=%2Fcalendar%3Fdate%3D2008-04-01" }
  );
  try {
    expect(
      view.container.querySelector(".messages-workspace")?.getAttribute("data-reader-open")
    ).toBe("false");
    expect(view.queryByRole("article", { name: "Selected message" })).toBeNull();
    expect(view.queryByText("Select a Message record")).toBeNull();
    fireEvent.click(view.getByRole("button", { name: /Exercise communications preview/ }));
    expect(view.getByRole("article", { name: "Selected message" })).toBeTruthy();
    expect(
      view.container.querySelector(".messages-workspace")?.getAttribute("data-reader-open")
    ).toBe("true");
    fireEvent.click(view.getByRole("button", { name: "Close message" }));
    expect(view.queryByRole("article", { name: "Selected message" })).toBeNull();
    expect(
      view.container.querySelector(".messages-workspace")?.getAttribute("data-reader-open")
    ).toBe("false");
    expect(view.queryByRole("button", { name: "Close message" })).toBeNull();
    expect(document.activeElement).toBe(
      view.getByRole("button", { name: /Exercise communications preview/ })
    );
    expect(
      (view.getByRole("searchbox", { name: "Search Message records" }) as HTMLInputElement).value
    ).toBe("preview");
    expect(view.getByRole("link", { name: "Return to Calendar" }).getAttribute("href")).toBe(
      "/calendar?date=2008-04-01"
    );
  } finally {
    view.unmount();
    client.clear();
  }
});

test("notification links open the requested lifecycle tab", () => {
  const view = renderWithProviders(<MessageReader message={create(MessageRecordSchema)} />, {
    route: "/messages?record=example&tab=lifecycle",
  });
  expect(view.getByRole("tab", { name: "Lifecycle" }).getAttribute("aria-selected")).toBe("true");
});
