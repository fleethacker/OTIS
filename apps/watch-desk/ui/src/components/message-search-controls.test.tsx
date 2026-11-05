import { expect, test } from "bun:test";
import { fireEvent } from "@testing-library/react";
import { renderWithProviders } from "../test-utils/render";
import { MessageSearchControls, MessagePagination } from "./message-search-controls";
import type { MessageFilters } from "./message-search-state";

test("filter selections apply together and sort choices expose the approved orders", () => {
  let applied: MessageFilters | undefined;
  let sorted = "";
  const view = renderWithProviders(
    <MessageSearchControls
      fields={{ messageType: "", sender: "", fromDate: "", throughDate: "" }}
      sort="relevance"
      query="exercise"
      activeFilters={0}
      options={{ messageTypes: ["OPTASK COMMS", "OPTASK RAS"], originators: ["TRAINING GROUP 99"] }}
      optionsPending={false}
      optionsFailed={false}
      retryOptions={() => {}}
      onApply={(value) => {
        applied = value;
      }}
      onSort={(value) => {
        sorted = value;
      }}
    />
  );
  fireEvent.click(view.getByRole("button", { name: "Message filters" }));
  fireEvent.change(view.getByLabelText("Message type"), { target: { value: "OPTASK RAS" } });
  fireEvent.change(view.getByLabelText("Sender"), { target: { value: "TRAINING GROUP 99" } });
  fireEvent.change(view.getByLabelText("Issued from (Zulu)"), { target: { value: "2008-04-01" } });
  expect(applied).toBeUndefined();
  fireEvent.click(view.getByRole("button", { name: "Apply filters" }));
  expect(applied).toEqual({
    messageType: "OPTASK RAS",
    sender: "TRAINING GROUP 99",
    fromDate: "2008-04-01",
    throughDate: "",
  });
  expect(view.queryByRole("dialog")).toBeNull();
  fireEvent.click(view.getByRole("button", { name: "Sort results" }));
  expect(view.getAllByRole("menuitemradio").length).toBe(3);
  fireEvent.click(view.getByRole("menuitemradio", { name: "Issue time — oldest first" }));
  expect(sorted).toBe("issued_asc");
});
test("pagination shows the record count and follows opaque previous/next pages", () => {
  let page = "";
  const view = renderWithProviders(
    <MessagePagination
      meta={{
        page: 2,
        totalPages: 3,
        totalRecords: 45,
        totalRelation: "eq",
        previousPageToken: "before",
        nextPageToken: "after",
      }}
      count={20}
      pending={false}
      failed={false}
      onPage={(value) => {
        page = value;
      }}
    />
  );
  expect(view.getByRole("status").textContent).toBe("45 records");
  fireEvent.click(view.getByRole("button", { name: "Previous results page" }));
  expect(page).toBe("before");
  fireEvent.click(view.getByRole("button", { name: "Next results page" }));
  expect(page).toBe("after");
});
