import { expect, test } from "bun:test";
import { renderWithProviders } from "../test-utils/render";
import { ExtractedTimeline } from "./extracted-timeline";
import { readSource } from "./source-data";

test("source adapter sends typed filters and preserves server order, cursor and full keys", async () => {
  const original = globalThis.fetch;
  let sent: Record<string, unknown> | undefined;
  globalThis.fetch = (async (input, init) => {
    expect(String(input)).toBe("/api/v1/messages/search");
    sent = JSON.parse(String(init?.body));
    return Response.json({
      messages: [
        { id: "2", sourceMessageId: "sha256:b@r1" },
        { id: "1", sourceMessageId: "sha256:a@r2" },
      ],
      source: "parse-command-opensearch",
      notice: "bounded",
      meta: { nextPageToken: "opaque", executedMode: "keyword" },
    });
  }) as typeof fetch;
  try {
    const result = await readSource("search", {
      query: "comms",
      mode: "keyword",
      filters: { commandIds: ["COMMAND"] },
    });
    expect(result.messages.map((m) => m.sourceMessageId)).toEqual(["sha256:b@r1", "sha256:a@r2"]);
    expect(result.meta.nextPageToken).toBe("opaque");
    expect(sent).toEqual({ query: "comms", mode: "keyword", filters: { commandIds: ["COMMAND"] } });
  } finally {
    globalThis.fetch = original;
  }
});
test("source failures do not silently fall back to fixture or keyword data", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () =>
    Response.json({ message: "Local model unavailable" }, { status: 503 })) as typeof fetch;
  try {
    await expect(readSource("search", { query: "comms", mode: "hybrid" })).rejects.toThrow(
      "Local model unavailable"
    );
  } finally {
    globalThis.fetch = original;
  }
});
test("extracted timeline shows exact point times without duration and keeps unresolved facts off the plot", () => {
  const view = renderWithProviders(
    <ExtractedTimeline
      from={Date.parse("2026-11-04T00:00:00Z")}
      to={Date.parse("2026-11-05T00:00:00Z")}
      returnTo="/calendar"
      items={[
        {
          key: "point",
          messageKey: "source@r1",
          title: "Crypto change",
          kind: "point",
          at: "2026-11-04T10:00:00Z",
          reviewRequired: true,
        },
      ]}
      review={[
        {
          key: "unknown",
          messageKey: "source@r1",
          title: "Unresolved <script>",
          kind: "unresolved",
          reason: "Date missing",
          reviewRequired: true,
        },
      ]}
    />
  );
  expect(view.getByText(/Point: 2026-11-04 10:00/)).toBeTruthy();
  expect(view.container.querySelectorAll(".extracted-point").length).toBe(1);
  expect(view.container.querySelectorAll(".extracted-interval").length).toBe(0);
  expect(view.getByText("Unresolved <script>")).toBeTruthy();
  expect(view.container.querySelector("script")).toBeNull();
  expect(view.getByText(/Requires review/)).toBeTruthy();
});
