import { describe, expect, it } from "bun:test";
import { renderWithProviders } from "./render";

describe("renderWithProviders", () => {
  it("resolves application assets against the local app origin", () => {
    const image = document.createElement("img");
    image.src = "/logo.svg";
    expect(image.src).toBe("http://localhost/logo.svg");
  });

  it("wraps a component in the app provider stack without throwing", () => {
    const { getByText } = renderWithProviders(<div>hello world</div>);
    expect(getByText("hello world")).toBeInTheDocument();
  });

  it("sets the daisyUI data-theme contract before rendering", () => {
    const { getByText } = renderWithProviders(<span>themed content</span>);
    expect(getByText("themed content")).toBeInTheDocument();
    // App Shell picks the theme (a daisyUI built-in preset or a custom ark-<name>).
    // The template ships "light" as a placeholder. Any non-empty value satisfies the contract.
    expect(document.documentElement.getAttribute("data-theme")).toBeTruthy();
  });
});
