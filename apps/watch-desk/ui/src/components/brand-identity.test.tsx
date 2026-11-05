import { expect, test } from "bun:test";
import { create } from "@bufbuild/protobuf";
import { renderWithProviders } from "../test-utils/render";
import { MessageRecordSchema } from "../gen/app/v1/models_pb";
import { ShipMarker } from "./ship-marker";
import { HullNumber } from "./ship-name";
import { ShipSymbol } from "./ship-symbol";
import { StructuredMessage } from "./structured-message";
import { OptaskIcon } from "./optask-icons";

test("ship names do not imply a domain, friendly affiliation, or vessel class", () => {
  const view = renderWithProviders(<ShipMarker unit="  USS Test DDG-999  " />);
  expect(view.getByText("USS Test DDG-999")).toBeTruthy();
  const symbol = view.getByRole("img", {
    name: "Unknown-domain symbol: affiliation unknown; entity unspecified",
  });
  expect(symbol.getAttribute("data-sidc")).toBe("10010000000000000000");
  expect(symbol.textContent).toBe("?");
  expect(view.container.querySelector(".hull-number")).toBeNull();
  // Calendar series identity remains separate from military affiliation.
  expect(view.container.querySelector(".ship-marker")).toBeTruthy();
});

test("missing unit text remains unavailable rather than displaying a vessel identity", () => {
  const view = renderWithProviders(<ShipMarker unit="  " />);
  expect(view.getByText("Unassigned / ship unavailable")).toBeTruthy();
  expect(view.queryByRole("img")).toBeNull();
  expect(view.container.querySelector(".ship-name")).toBeNull();
});

test("explicit source affiliation can select the friendly sea-surface symbol", () => {
  const view = renderWithProviders(<ShipSymbol domain="surface" affiliation="friend" />);
  expect(
    view
      .getByRole("img", { name: "Sea surface symbol: friendly; entity unspecified" })
      .getAttribute("data-sidc")
  ).toBe("10033000000000000000");
});

test("explicit ship metadata selects the subsurface domain without parsing the name", () => {
  const view = renderWithProviders(
    <ShipMarker unit="Test vessel" domain="subsurface" affiliation="friend" />
  );
  expect(
    view
      .getByRole("img", { name: "Sea subsurface symbol: friendly; entity unspecified" })
      .getAttribute("data-sidc")
  ).toBe("10033500000000000000");
});

test("hull identifiers preserve supplied characters and never interpret markup", () => {
  const view = renderWithProviders(<HullNumber value="DDG-099 <source>" />);
  expect(view.getByText("DDG-099 <source>").className).toBe("hull-number");
  expect(view.container.querySelector("source")).toBeNull();
});

test("maritime message categories use their correct domain without inventing vessel identity", () => {
  for (const [type, domain, sidc] of [
    ["OPTASK ASUW", "surface", "10013000000000000000"],
    ["OPTASK ASW", "subsurface", "10013500000000000000"],
  ]) {
    const view = renderWithProviders(<OptaskIcon type={type} />);
    const symbol = view.getByRole("img", {
      name: `${type} message category. Sea ${domain} symbol: affiliation unknown; entity unspecified`,
    });
    expect(symbol.getAttribute("data-sidc")).toBe(sidc);
    expect(symbol.classList.contains("optask-icon")).toBe(true);
    view.unmount();
  }
});

test("explicit friendly subsurface identity retains the subsurface frame", () => {
  const view = renderWithProviders(<ShipSymbol domain="subsurface" affiliation="friend" />);
  const symbol = view.getByRole("img", {
    name: "Sea subsurface symbol: friendly; entity unspecified",
  });
  expect(symbol.getAttribute("data-sidc")).toBe("10033500000000000000");
  expect(symbol.querySelector("circle")).toBeNull();
  expect(symbol.querySelector("path")).toBeTruthy();
});

test("other message categories retain their existing category icon", () => {
  const view = renderWithProviders(<OptaskIcon type="OPTASK COMMS" />);
  const icon = view.getByRole("img", { name: "OPTASK COMMS" });
  expect(icon.classList.contains("optask-icon")).toBe(true);
  expect(icon.hasAttribute("data-sidc")).toBe(false);
});

test("reader preserves ordered source-set cards, repeated narratives, and table rows", () => {
  const set = (set_id: string, values: string[]) => ({
    set_id,
    fields: values.map((value, index) => ({ position: index + 1, value })),
    rows: [],
  });
  const narrative = "Keep slash / and HTTP://example.invalid/path <source>";
  const view = renderWithProviders(
    <StructuredMessage
      message={create(MessageRecordSchema, {
        structuredPayloadJson: JSON.stringify({
          subject: "Original source subject",
          source_profile: "observed-optask-extensions-v1",
          extra_source_field: "Internal metadata is not a source set",
          sets: [
            set("MSGID", ["OPTASK COMMS", "EXERCISE COMMAND"]),
            set("GENTEXT", ["REPORTING", narrative]),
            set("GENTEXT", ["REPORTING", "Second occurrence"]),
            set("AMPN", ["Amplification / preserved"]),
            set("NARR", ["Original narrative"]),
            set("RMKS", ["Original remarks"]),
            set("TESTSET", ["Unmapped source value"]),
            {
              ...set("TABLESET", []),
              rows: [{ fields: [{ position: 1, value: "Original table cell" }] }],
            },
            set("GENTEXT", ["NINTH SET", "Still in source order"]),
          ],
        }),
      })}
    />
  );
  expect(view.getByRole("heading", { name: /^MSGID - / })).toBeTruthy();
  expect(view.getAllByRole("region", { name: "GENTEXT — REPORTING" })).toHaveLength(2);
  expect(view.getByRole("heading", { name: "NINTH SET" })).toBeTruthy();
  expect(view.getByText(narrative)).toBeTruthy();
  expect(view.getByText("Second occurrence")).toBeTruthy();
  expect(view.getByText("Unmapped source value")).toBeTruthy();
  expect(view.getByRole("cell", { name: "Original table cell" })).toBeTruthy();
  expect(view.container.querySelector("source")).toBeNull();
  expect(view.queryByText("Internal metadata is not a source set")).toBeNull();
});
