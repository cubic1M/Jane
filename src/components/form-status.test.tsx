import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FormStatus } from "./form-status";

// What a form's action said: hidden before it answers, green when it worked, red when not.

describe("FormStatus", () => {
  it("stays hidden until there's an answer", () => {
    expect(renderToStaticMarkup(<FormStatus state={null} />)).toBe(
      '<p role="status" class="sr-only"></p>',
    );
  });

  it("shows the answer in green or red", () => {
    expect(renderToStaticMarkup(<FormStatus state={{ ok: true, message: "Saved." }} />)).toBe(
      '<p role="status" class="text-sm text-emerald-800">Saved.</p>',
    );
    expect(renderToStaticMarkup(<FormStatus state={{ ok: false, message: "Try again." }} />)).toBe(
      '<p role="status" class="text-sm text-red-700">Try again.</p>',
    );
  });
});
