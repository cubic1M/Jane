import { describe, expect, it, vi } from "vitest";
import { rageClickFields } from "./recorder";

// Just enough of an element: the recorder only reads these.
const element = (tagName: string, innerText: string) =>
  ({
    tagName,
    innerText,
    closest: () => null,
    querySelector: () => null,
    getAttribute: () => null,
  }) as unknown as Element;

describe("a rage click", () => {
  vi.stubGlobal("HTMLInputElement", class {});

  // A triple click selects text, so a chat bubble's words went on the activity log, up to 80
  // characters kept 180 days, though /privacy says "not what you typed".
  it("keeps no words from plain text", () => {
    const words = element("P", "something the person wrote");
    expect(rageClickFields(null, words).label).toBeUndefined();
  });

  it("names something meant to be clicked", () => {
    const button = element("BUTTON", "Save");
    expect(rageClickFields(button, button)).toEqual({ role: "button", label: "Save" });
  });
});
