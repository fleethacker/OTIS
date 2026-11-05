import "../route-registry";
import { expect, test } from "bun:test";
import { act, fireEvent, waitFor } from "@testing-library/react";
import { useLocation, useNavigate } from "react-router-dom";
import { renderWithProviders } from "../test-utils/render";
import { useCalendarParams } from "./calendar-params";

function Controls() {
  const [params, update] = useCalendarParams();
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <input
        aria-label="Search"
        value={params.get("q") ?? ""}
        onChange={(e) => update((p) => p.set("q", e.target.value), true)}
      />
      <button onClick={() => update((p) => p.set("view", "week"))}>Week</button>
      <button
        onClick={() => {
          void navigate(-1);
        }}
      >
        Back
      </button>
      <output>{location.search}</output>
    </>
  );
}
test("burst typing and a same-turn view change preserve the latest query and other parameters", async () => {
  const view = renderWithProviders(<Controls />, {
    route: "/calendar?date=2026-11-05&ships=%5B%5D&shipLayout=side",
  });
  const input = view.getByLabelText("Search") as HTMLInputElement;
  try {
    // No waits between characters; append to the actual controlled DOM value.
    await act(async () => {
      for (const character of "communications")
        fireEvent.change(input, { target: { value: input.value + character } });
      fireEvent.click(view.getByText("Week"));
    });
    await waitFor(() =>
      expect(view.container.querySelector("output")!.textContent).toContain("q=communications")
    );
    expect(input).toHaveValue("communications");
    expect(view.container.querySelector("output")!.textContent).toContain("ships=%5B%5D");
    expect(view.container.querySelector("output")!.textContent).toContain("shipLayout=side");
    await act(async () => {
      fireEvent.click(view.getByText("Back"));
    });
    await waitFor(() =>
      expect(view.container.querySelector("output")!.textContent).not.toContain("view=week")
    );
    expect(input).toHaveValue("communications");
    await act(async () => {
      fireEvent.change(input, { target: { value: "radio rehearsal" } });
    });
    await waitFor(() =>
      expect(view.container.querySelector("output")!.textContent).toContain("q=radio+rehearsal")
    );
    await act(async () => {
      fireEvent.change(input, { target: { value: "" } });
    });
    await waitFor(() => expect(input).toHaveValue(""));
  } finally {
    view.unmount();
  }
});
