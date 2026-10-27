import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BusyBar, busyClassName, SubmitButton } from "./submit-button";

// A form's submit button that answers the tap at once: before any tap it is a plain submit
// button with everything passed through, and no spinner.

describe("SubmitButton", () => {
  it("renders a plain submit button until it's pressed", () => {
    const html = renderToStaticMarkup(
      <form>
        <SubmitButton className="link" name="actionId" value="yes">
          Yes
        </SubmitButton>
      </form>,
    );
    expect(html).toBe(
      '<form><button type="submit" value="yes" class="link" name="actionId">Yes</button></form>',
    );
  });

  it("keeps a button disabled when it's told to be", () => {
    const html = renderToStaticMarkup(<SubmitButton disabled>Undo</SubmitButton>);
    expect(html).toContain("disabled");
    expect(html).not.toContain("aria-busy");
  });
});

// The press shows a calm bar, never a "| / - \" text spinner (founder, 2026-10-27).
describe("BusyBar", () => {
  it("is a thin bar with no text in it", () => {
    const html = renderToStaticMarkup(<BusyBar />);
    expect(html).toContain("data-busy-bar");
    expect(html).toContain("busy-bar");
    expect(html).toContain('aria-hidden="true"');
    expect(html.replace(/<[^>]+>/g, "")).toBe("");
  });
});

describe("busyClassName", () => {
  it("makes the pressed button hold the bar", () => {
    expect(busyClassName("link")).toBe("link relative");
    expect(busyClassName(undefined)).toBe("relative");
  });

  it("leaves a button that is already positioned as it is", () => {
    expect(busyClassName("absolute right-2 top-2")).toBe("absolute right-2 top-2");
    expect(busyClassName("sticky bottom-0")).toBe("sticky bottom-0");
  });
});
