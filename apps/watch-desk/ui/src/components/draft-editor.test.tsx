import { expect, test } from "bun:test";
import { act, fireEvent, waitFor } from "@testing-library/react";
import { createRouterTransport, ConnectError, Code } from "@connectrpc/connect";
import { TransportProvider } from "@connectrpc/connect-query";
import { AppService } from "../gen/app/v1/app_pb";
import { DraftService } from "../gen/app/v1/drafts_pb";
import { renderWithProviders } from "../test-utils/render";
import { DraftEditor } from "./draft-editor";

test("draft editor names its source and honest loading state", () => {
  const transport = createRouterTransport((router) => {
    router.service(AppService, { getIdentity: () => new Promise(() => {}) });
  });
  const view = renderWithProviders(
    <TransportProvider transport={transport}>
      <DraftEditor source="FICTIONAL-001" />
    </TransportProvider>
  );
  expect(view.getByText("Re: FICTIONAL-001")).toBeTruthy();
  expect(view.getByRole("status").textContent).toContain("Loading draft");
  expect(view.queryByRole("button", { name: "Send" })).toBeNull();
});

test("account changes discard active/inactive private drafts and unsaved text while reads wait or fail", async () => {
  let account = "alpha";
  let hold = false;
  let fail = false;
  let release: (() => void) | undefined;
  const writes: string[] = [];
  const transport = createRouterTransport((router) => {
    router.service(AppService, {
      getIdentity: () => ({
        username: account,
        email: `${account}@example.test`,
        role: "watchstander",
      }),
    });
    router.service(DraftService, {
      readDraft: async () => {
        const owner = account;
        if (hold)
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        if (fail) throw new ConnectError("Unavailable", Code.Unavailable);
        return { draft: { text: `${owner} private` } };
      },
      saveDraft: (request) => {
        writes.push(`${account}:${request.text}`);
        return { draft: { text: request.text } };
      },
    });
  });
  const ui = (source: string) => (
    <TransportProvider transport={transport}>
      <DraftEditor source={source} />
    </TransportProvider>
  );
  const view = renderWithProviders(ui("ONE"));
  await waitFor(() =>
    expect((view.getByLabelText("Acknowledgement text") as HTMLTextAreaElement).value).toBe(
      "alpha private"
    )
  );
  view.rerender(ui("TWO"));
  await waitFor(() => expect(view.getByLabelText("Acknowledgement text")).toBeTruthy());
  fireEvent.change(view.getByLabelText("Acknowledgement text"), {
    target: { value: "alpha unsaved" },
  });
  account = "beta";
  hold = true;
  act(() => {
    window.dispatchEvent(new MessageEvent("message", { data: { type: "ark-auth-changed" } }));
  });
  await waitFor(() => expect(release).toBeDefined());
  expect(view.queryByLabelText("Acknowledgement text")).toBeNull();
  expect(view.queryByRole("button", { name: "Save draft" })).toBeNull();
  fail = true;
  await act(async () => {
    release?.();
  });
  await waitFor(() => expect(view.getByRole("alert").textContent).toContain("could not be loaded"));
  expect(view.queryByLabelText("Acknowledgement text")).toBeNull();
  expect(writes).toEqual([]);
  hold = false;
  fail = false;
  fireEvent.click(view.getByRole("button", { name: "Retry loading draft" }));
  await waitFor(() =>
    expect((view.getByLabelText("Acknowledgement text") as HTMLTextAreaElement).value).toBe(
      "beta private"
    )
  );
  view.rerender(ui("ONE"));
  await waitFor(() =>
    expect((view.getByLabelText("Acknowledgement text") as HTMLTextAreaElement).value).toBe(
      "beta private"
    )
  );
  fireEvent.click(view.getByRole("button", { name: "Save draft" }));
  await waitFor(() => expect(writes).toEqual(["beta:beta private"]));
});
