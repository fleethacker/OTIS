import { expect, test } from "bun:test";
import { act, fireEvent, waitFor } from "@testing-library/react";
import { createRouterTransport, ConnectError, Code } from "@connectrpc/connect";
import { TransportProvider } from "@connectrpc/connect-query";
import { AppService } from "../gen/app/v1/app_pb";
import { DraftService } from "../gen/app/v1/drafts_pb";
import { renderWithProviders } from "../test-utils/render";
import { DraftEditor, PrivateComposer, PrivateTracking } from "./draft-editor";
import { blankPreparation, formatPreparation, type PreparationFields } from "./preparation-format";

const synthetic = {
  ...blankPreparation,
  outgoing: "USS EXAMPLE",
  letter: "A",
  type: "OPTASK LINK",
  originator: "CTF DEMO",
  dtg: "041200ZNOV2026",
  authority: "USS EXAMPLE",
  family: "ACTAGCY",
  response: "WILCO",
  confirmed: true,
};
test("rendered composer preserves legacy, handles failures, invalidates output and shares tracking", async () => {
  let fail = true;
  let state = {
    fieldsJson: JSON.stringify(synthetic),
    generatedText: formatPreparation(synthetic),
    acknowledged: false,
    historyJson: "[]",
  };
  let clipboardFails = true;
  let copied = "";
  const previous = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: async (text: string) => {
        if (clipboardFails) {
          throw new Error("denied");
        }
        copied = text;
      },
    },
  });
  const transport = createRouterTransport((router) => {
    router.service(AppService, { getIdentity: () => ({ username: "alpha" }) });
    router.service(DraftService, {
      readDraft: () => ({ draft: { text: "legacy exact\n" } }),
      readPreparation: () => state,
      savePreparation: (request) => {
        if (fail) {
          throw new ConnectError("Unavailable", Code.Unavailable);
        }
        const fields = JSON.parse(request.fieldsJson) as PreparationFields;
        state = {
          ...state,
          fieldsJson: request.fieldsJson,
          generatedText: request.generate ? formatPreparation(fields) : "",
        };
        return state;
      },
      recordAcknowledgement: (request) => {
        state = {
          ...state,
          acknowledged: request.acknowledged,
          historyJson: JSON.stringify([
            {
              id: 1,
              kind: request.acknowledged ? "acknowledged" : "reset",
              recorder: "alpha",
              recorded_at: "2026-11-04T12:00:00Z",
              occurred_at: null,
              note: request.note,
              provenance: "user-reported",
            },
          ]),
        };
        return state;
      },
    });
  });
  const view = renderWithProviders(
    <TransportProvider transport={transport}>
      <DraftEditor source="ONE">
        <PrivateComposer source="ONE" subject="Synthetic reference" />
        <PrivateTracking source="ONE" />
      </DraftEditor>
    </TransportProvider>
  );
  try {
    await waitFor(() => expect(view.getByLabelText("Outgoing originator")).toBeTruthy());
    expect((view.getByLabelText("Acknowledgement text") as HTMLTextAreaElement).value).toBe(
      "legacy exact\n"
    );
    fireEvent.click(view.getByRole("button", { name: "Copy message" }));
    await waitFor(() =>
      expect(view.getByText("Copy failed. Select the preview text and copy manually.")).toBeTruthy()
    );
    clipboardFails = false;
    fireEvent.click(view.getByRole("button", { name: "Copy message" }));
    await waitFor(() => expect(copied).toBe(formatPreparation(synthetic)));
    expect(state.acknowledged).toBe(false);
    fireEvent.change(view.getByLabelText("Outgoing originator"), { target: { value: "CHANGED" } });
    expect((view.getByRole("button", { name: "Copy message" }) as HTMLButtonElement).disabled).toBe(
      true
    );
    expect(
      (view.getByLabelText("Reviewable message (plain text)") as HTMLTextAreaElement).value
    ).toBe("");
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    fireEvent.click(view.getByRole("button", { name: "Generate message" }));
    await waitFor(() =>
      expect(
        view.getByText("Preparation save failed. Inputs retained; retry saving or generating.")
      ).toBeTruthy()
    );
    expect((view.getByLabelText("Outgoing originator") as HTMLInputElement).value).toBe("CHANGED");
    fail = false;
    fireEvent.click(view.getByRole("button", { name: "Generate message" }));
    await waitFor(() => expect(view.getByText("Generated and saved · Unsent")).toBeTruthy());
    expect(state.acknowledged).toBe(false);
    fireEvent.click(view.getByRole("button", { name: "Record external acknowledgement" }));
    await waitFor(() =>
      expect(view.getByText("Confirm that acknowledgement occurred outside OTIS.")).toBeTruthy()
    );
    fireEvent.click(view.getByLabelText("I confirm acknowledgement occurred outside OTIS."));
    fireEvent.click(view.getByRole("button", { name: "Record external acknowledgement" }));
    await waitFor(() =>
      expect(view.getByText("Acknowledged · User-reported outside OTIS")).toBeTruthy()
    );
    expect(view.getByText("Occurred: Unavailable")).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Reset personal tracking" }));
    await waitFor(() =>
      expect(view.getByText("Not recorded as acknowledged in personal tracking")).toBeTruthy()
    );
    expect((view.getByLabelText("Acknowledgement text") as HTMLTextAreaElement).value).toBe(
      "legacy exact\n"
    );
    act(() => {
      window.dispatchEvent(new MessageEvent("message", { data: { type: "ark-auth-changed" } }));
    });
    await waitFor(() =>
      expect((view.getByLabelText("Outgoing originator") as HTMLInputElement).value).toBe("CHANGED")
    );
  } finally {
    if (previous) {
      Object.defineProperty(navigator, "clipboard", previous);
    } else {
      Reflect.deleteProperty(navigator, "clipboard");
    }
  }
});

test("missing source metadata starts blank and does not prevent incomplete saving", async () => {
  let submitted = "";
  const transport = createRouterTransport((router) => {
    router.service(AppService, { getIdentity: () => ({ username: "alpha" }) });
    router.service(DraftService, {
      readDraft: () => ({}),
      readPreparation: () => ({ fieldsJson: "{}", historyJson: "[]" }),
      savePreparation: (request) => {
        submitted = request.fieldsJson;
        return { fieldsJson: submitted, historyJson: "[]" };
      },
    });
  });
  const view = renderWithProviders(
    <TransportProvider transport={transport}>
      <DraftEditor source="EMPTY">
        <PrivateComposer source="EMPTY" subject="Not a reference type" />
      </DraftEditor>
    </TransportProvider>
  );
  await waitFor(() => expect(view.getByLabelText("Reference message type")).toBeTruthy());
  expect((view.getByLabelText("Reference message type") as HTMLInputElement).value).toBe("");
  expect((view.getByLabelText("Reference letter (A-Z)") as HTMLInputElement).value).toBe("");
  fireEvent.click(view.getByRole("button", { name: "Generate message" }));
  await waitFor(() =>
    expect(
      view.getByText("confirmed: Confirm understanding and authority before generation.")
    ).toBeTruthy()
  );
  fireEvent.click(view.getByRole("button", { name: "Save preparation" }));
  await waitFor(() => expect(submitted).toBe(JSON.stringify(blankPreparation)));
});

test("private preparation and tracking discard late account responses and isolate records", async () => {
  let account = "alpha";
  let hold = true;
  let release: (() => void) | undefined;
  const transport = createRouterTransport((router) => {
    router.service(AppService, { getIdentity: () => ({ username: account }) });
    router.service(DraftService, {
      readDraft: () => ({}),
      readPreparation: async (request) => {
        const owner = account;
        if (hold) {
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        }
        return {
          fieldsJson: JSON.stringify({ outgoing: `${owner}-${request.sourceMessageId}` }),
          acknowledged: owner === "alpha",
          historyJson: "[]",
        };
      },
    });
  });
  const ui = (source: string) => (
    <TransportProvider transport={transport}>
      <DraftEditor source={source}>
        <PrivateComposer source={source} subject="Reference" />
        <PrivateTracking source={source} />
      </DraftEditor>
    </TransportProvider>
  );
  const view = renderWithProviders(ui("ONE"));
  await waitFor(() => expect(release).toBeDefined());
  account = "beta";
  hold = false;
  act(() => {
    window.dispatchEvent(new MessageEvent("message", { data: { type: "ark-auth-changed" } }));
  });
  await waitFor(() =>
    expect((view.getByLabelText("Outgoing originator") as HTMLInputElement).value).toBe("beta-ONE")
  );
  await act(async () => {
    release?.();
  });
  expect((view.getByLabelText("Outgoing originator") as HTMLInputElement).value).toBe("beta-ONE");
  expect(view.queryByText("Acknowledged · User-reported outside OTIS")).toBeNull();
  view.rerender(ui("TWO"));
  await waitFor(() =>
    expect((view.getByLabelText("Outgoing originator") as HTMLInputElement).value).toBe("beta-TWO")
  );
});
