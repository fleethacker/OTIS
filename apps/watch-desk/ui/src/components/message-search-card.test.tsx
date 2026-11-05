import { expect, test } from "bun:test";
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { fireEvent } from "@testing-library/react";
import { MessageRecordSchema } from "../gen/app/v1/models_pb";
import { renderWithProviders } from "../test-utils/render";
import { MessageSearchCard } from "./message-search-card";

const message = create(MessageRecordSchema, {
  sourceMessageId: "internal-hash@parser-revision",
  subject: "Exercise communications plan",
  sender: "EMAIL FORWARDER",
  receivedAt: timestampFromDate(new Date("2026-11-05T00:12:42Z")),
});

test("search card shows source header and Zulu issue time, retaining seconds and selection", () => {
  let selections = 0;
  const rendered = renderWithProviders(
    <MessageSearchCard
      message={message}
      header={{
        type: "OPTASK COMMS",
        originator: "TRAINING GROUP 99",
        issuedAt: "2008-03-31T18:00:30Z",
      }}
      selected
      onSelect={() => {
        selections += 1;
      }}
    />
  );
  expect(rendered.getByRole("img", { name: "OPTASK COMMS" })).toBeTruthy();
  expect(rendered.getByText("Exercise communications plan")).toBeTruthy();
  expect(rendered.getByText("TRAINING GROUP 99")).toBeTruthy();
  const time = rendered.getByText("31 MAR 2008 180030Z");
  expect(time.getAttribute("datetime")).toBe("2008-03-31T18:00:30Z");
  expect(rendered.queryByText(/internal-hash|parser-revision|EMAIL FORWARDER|2026/)).toBeNull();
  const card = rendered.getByRole("button");
  expect(card.getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(card);
  expect(selections).toBe(1);
});

test("missing or invalid issue metadata never substitutes email receipt time or sender", () => {
  for (const issuedAt of [undefined, "invalid"]) {
    const rendered = renderWithProviders(
      <MessageSearchCard
        message={message}
        header={{ issuedAt }}
        selected={false}
        onSelect={() => {}}
      />
    );
    expect(rendered.getByText("Type unavailable")).toBeTruthy();
    expect(rendered.getByText("Originator unavailable")).toBeTruthy();
    expect(rendered.getByText("Issue time unavailable")).toBeTruthy();
    expect(rendered.queryByText(/2026|EMAIL FORWARDER|Invalid date/)).toBeNull();
    rendered.unmount();
  }
});
