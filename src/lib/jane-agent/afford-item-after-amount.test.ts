import { describe, expect, it } from "vitest";
import { parseIntent } from "./intents";

// Debugger 11-17 (r321, chat on a phone): "can I afford a $300 flight home for thanksgiving?"
// answered "Yes: after $300.00 on thanksgiving now, …". The thing bought is what follows the
// amount, not what it's for.

const whatOf = (text: string) => {
  const intent = parseIntent(text, "2026-11-17");
  return intent.kind === "afford" ? intent.what : `not afford: ${intent.kind}`;
};

describe("what a purchase is, when the amount comes first", () => {
  it("is the thing after the amount", () => {
    expect(whatOf("can I afford a $300 flight home for thanksgiving?")).toBe("a flight home");
    expect(whatOf("can i afford a $1,200 couch in march")).toBe("a couch");
  });

  it("is still the for or on part otherwise", () => {
    expect(whatOf("can i afford $900 for a trip in march")).toBe("a trip");
    expect(whatOf("can i afford a vacation")).toBe("a vacation");
  });
});
