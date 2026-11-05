import { SettingsContext, type SettingsReply } from "./settings-data";
import { expect, test } from "bun:test";
import { create } from "@bufbuild/protobuf";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { createRouterTransport, ConnectError, Code } from "@connectrpc/connect";
import { TransportProvider } from "@connectrpc/connect-query";
import { AppService } from "../gen/app/v1/app_pb";
import { DraftService } from "../gen/app/v1/drafts_pb";
import { MessageRecordSchema } from "../gen/app/v1/models_pb";
import { renderWithProviders } from "../test-utils/render";
import { MessageReader } from "./message-reader";
import { acknowledgementDefaults, referenceDtg } from "./acknowledgement-format";
import { formatPreparation, type PreparationFields } from "./preparation-format";

const configured: SettingsReply = {
  revision: "1:1",
  settings: {
    version: 1,
    shipName: "",
    unitName: "",
    commandIds: [],
    outgoingCommand: "FLEETHACKER",
    actionAuthority: "FLEETHACKER",
    defaultTimezone: "UTC",
    ai: null,
  },
};
const message = (issued_at: string | null = "2026-11-04T12:34:30Z") =>
  create(MessageRecordSchema, {
    sourceMessageId: "synthetic-ack@r1",
    structuredPayloadJson: JSON.stringify({
      type: "OPTASK LINK",
      originator: "EXERCISE GROUP",
      serial: "0010",
      issued_at,
      sets: [],
    }),
  });
test("acknowledgement defaults use source identity and reference time, never receipt time", () => {
  const fields = acknowledgementDefaults(message(), {
    outgoing: configured.settings.outgoingCommand,
    authority: configured.settings.actionAuthority,
  });
  expect(acknowledgementDefaults(message()).outgoing).toBe("");
  expect(fields.outgoing).toBe("FLEETHACKER");
  expect(fields.authority).toBe("FLEETHACKER");
  expect(fields.originator).toBe("EXERCISE GROUP");
  expect(fields.dtg).toBe("041234ZNOV2026");
  expect(fields.response).toBe("");
  expect(fields.confirmed).toBe(false);
  expect(acknowledgementDefaults(message(null)).dtg).toBe("");
  expect(referenceDtg("2026-02-30T12:00:00Z")).toBe("");
  const fromSet = message();
  fromSet.structuredPayloadJson = JSON.stringify({
    source_profile: "observed-optask-extensions-v1",
    sets: [{ set_id: "MSGID", fields: [{ position: 5, value: " PC-C001\n " }], rows: [] }],
  });
  expect(acknowledgementDefaults(fromSet).serial).toBe("PC-C001");
});
test("viewer one-dropdown modal generates an unsent draft, handles retry and keeps acknowledgement status accurate", async () => {
  let saved = "";
  let fail = true;
  let state = { fieldsJson: "{}", generatedText: "", acknowledged: false, historyJson: "[]" };
  const transport = createRouterTransport((router) => {
    router.service(AppService, { getIdentity: () => ({ username: "alpha", role: "viewer" }) });
    router.service(DraftService, {
      readPreparation: () => state,
      savePreparation: (request) => {
        if (fail) throw new ConnectError("Unavailable", Code.Unavailable);
        const fields = JSON.parse(request.fieldsJson) as PreparationFields;
        expect(request.generate).toBe(true);
        saved = formatPreparation(fields);
        state = { ...state, fieldsJson: request.fieldsJson, generatedText: saved };
        return state;
      },
    });
  });
  const view = renderWithProviders(
    <SettingsContext.Provider value={{ shared: configured, timezone: "UTC" }}>
      <TransportProvider transport={transport}>
        <MessageReader message={message()} />
      </TransportProvider>
    </SettingsContext.Provider>
  );
  await waitFor(() => expect(view.getByText("Not acknowledged")).toBeTruthy());
  const trigger = view.getByRole("button", { name: "Send Acknowledgement" });
  fireEvent.click(trigger);
  const modal = within(view.getByRole("dialog", { name: "Acknowledgement" }));
  expect(modal.getAllByRole("combobox")).toHaveLength(1);
  expect((modal.getByRole("combobox") as HTMLSelectElement).value).toBe("");
  expect(modal.queryByRole("checkbox")).toBeNull();
  expect(modal.getByRole("button", { name: "Generate draft" }).hasAttribute("disabled")).toBe(true);
  fireEvent.change(modal.getByRole("combobox"), { target: { value: "ACTAGCY:WILCO" } });
  expect((modal.getByLabelText("Draft · unsent") as HTMLTextAreaElement).value).toBe(
    "MSGID/AKNLDG/FLEETHACKER//\nREF/A/OPTASK LINK/EXERCISE GROUP/041234ZNOV2026/0010//\nACTAGCY/FLEETHACKER/WILCO/A//"
  );
  fireEvent.click(modal.getByRole("button", { name: "Generate draft" }));
  await waitFor(() => expect(modal.getByRole("alert").textContent).toContain("Retry"));
  fail = false;
  fireEvent.click(modal.getByRole("button", { name: "Generate draft" }));
  await waitFor(() => expect(modal.getByText("Draft saved · unsent")).toBeTruthy());
  expect(saved).toContain("ACTAGCY/FLEETHACKER/WILCO/A//");
  expect(state.acknowledged).toBe(false);
  expect(view.getByText("Draft ready · unsent")).toBeTruthy();
  fireEvent.change(modal.getByRole("combobox"), { target: { value: "ICVALID:VALID" } });
  const preview = (modal.getByLabelText("Draft · unsent") as HTMLTextAreaElement).value;
  expect(preview).toContain("ICVALID/FLEETHACKER/VALID/A//");
  expect(preview).not.toContain("ACTAGCY/");
  expect(modal.queryByRole("button", { name: "Copy draft" })).toBeNull();
  fireEvent.click(modal.getByRole("button", { name: "Close acknowledgement" }));
  expect(view.queryByRole("dialog")).toBeNull();
});
test("missing reference time blocks generation without fabricating receipt or current date", async () => {
  const transport = createRouterTransport((router) => {
    router.service(AppService, { getIdentity: () => ({ username: "alpha", role: "viewer" }) });
    router.service(DraftService, {
      readPreparation: () => ({
        fieldsJson: "{}",
        generatedText: "",
        acknowledged: false,
        historyJson: "[]",
      }),
    });
  });
  const view = renderWithProviders(
    <SettingsContext.Provider value={{ shared: configured, timezone: "UTC" }}>
      <TransportProvider transport={transport}>
        <MessageReader message={message(null)} />
      </TransportProvider>
    </SettingsContext.Provider>
  );
  await waitFor(() => expect(view.getByText("Not acknowledged")).toBeTruthy());
  fireEvent.click(view.getByRole("button", { name: "Send Acknowledgement" }));
  fireEvent.change(view.getByRole("combobox", { name: "Acknowledgement type" }), {
    target: { value: "ACTAGCY:ACK" },
  });
  expect(view.getByRole("alert").textContent).toBe("Reference incomplete: issue time.");
  expect(view.getByRole("button", { name: "Generate draft" }).hasAttribute("disabled")).toBe(true);
});
