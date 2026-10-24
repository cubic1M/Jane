import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SubmitButton } from "./submit-button";

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
      '<form><button type="submit" class="link" value="yes" name="actionId">Yes</button></form>',
    );
  });

  it("keeps a button disabled when it's told to be", () => {
    const html = renderToStaticMarkup(<SubmitButton disabled>Undo</SubmitButton>);
    expect(html).toContain("disabled");
    expect(html).not.toContain("aria-busy");
  });
});
