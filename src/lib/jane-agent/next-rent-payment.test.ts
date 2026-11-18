import { describe, expect, it } from "vitest";
import { parseIntent } from "./intents";

// Debugger 11-18 (r341, Plaid S6, rent to Essex Property Trust on the 1st, chat on a phone): "when
// is my next rent payment?" answered "I can't answer that one yet", though "when is rent due?"
// says what rent costs and when it's next paid.

const kind = (text: string) => parseIntent(text, "2026-11-18");

describe("when a bill is next paid", () => {
  it("is that bill, asked as its payment", () => {
    expect(kind("when is my next rent payment?")).toEqual(kind("when is rent due?"));
    expect(kind("when's my next phone bill?")).toMatchObject({ kind: "cost", target: "phone" });
  });

  it("isn't a name when it's every payment", () => {
    expect(kind("when is my next payment?")).not.toMatchObject({ kind: "cost" });
  });
});
