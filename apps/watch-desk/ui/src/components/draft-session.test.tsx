import { expect, test } from "bun:test";
import { act, fireEvent, waitFor } from "@testing-library/react";
import { Code, ConnectError, createRouterTransport } from "@connectrpc/connect";
import { TransportProvider } from "@connectrpc/connect-query";
import { AppService } from "../gen/app/v1/app_pb";
import { DraftService } from "../gen/app/v1/drafts_pb";
import { renderWithProviders } from "../test-utils/render";
import { DraftEditor } from "./draft-editor";

test("fresh identity verification gates drafts and fails closed even for identical display identities", async () => {
  let failIdentity = false;
  let holdIdentity = false;
  let release: (() => void) | undefined;
  let reads = 0;
  const transport = createRouterTransport((router) => {
    router.service(AppService, {
      getIdentity: async () => {
        if (holdIdentity)
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        if (failIdentity) throw new ConnectError("Unavailable", Code.Unavailable);
        return { username: "same-display-name" };
      },
    });
    router.service(DraftService, {
      readDraft: () => ({ draft: { text: `private generation ${++reads}` } }),
    });
  });
  const view = renderWithProviders(
    <TransportProvider transport={transport}>
      <DraftEditor source="ONE" />
    </TransportProvider>
  );
  await waitFor(() =>
    expect((view.getByLabelText("Acknowledgement text") as HTMLTextAreaElement).value).toBe(
      "private generation 1"
    )
  );
  holdIdentity = true;
  act(() => {
    window.dispatchEvent(new Event("storage"));
  });
  await waitFor(() => expect(release).toBeDefined());
  expect(view.queryByLabelText("Acknowledgement text")).toBeNull();
  expect(reads).toBe(1);
  failIdentity = true;
  await act(async () => {
    release?.();
  });
  await waitFor(() =>
    expect(view.getByRole("alert").textContent).toContain("Account could not be verified")
  );
  expect(view.queryByRole("button", { name: "Save draft" })).toBeNull();
  holdIdentity = false;
  failIdentity = false;
  fireEvent.click(view.getByRole("button", { name: "Retry account verification" }));
  await waitFor(() =>
    expect((view.getByLabelText("Acknowledgement text") as HTMLTextAreaElement).value).toBe(
      "private generation 2"
    )
  );
});
