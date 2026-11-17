import { describe, expect, it } from "vitest";
import { parseIntent } from "./intents";

// Debugger 11-17 (r328, Plaid sandbox, 14 months of checking and a card with $371 of interest and
// a doubled $86.40 Target charge, chat on a phone): "how much did I pay in interest this year?"
// answered "I can't answer that one yet", and "what happened with target?" answered "Nothing new
// this week. When I start on something, I'll tell you here." The first is the card's interest;
// the second is about Target, not about what Jane did.

const TODAY = "2026-11-17";
const kind = (text: string) => parseIntent(text, TODAY);

describe("interest paid", () => {
  it("is the card interest answer", () => {
    for (const text of [
      "how much did I pay in interest this year?",
      "how much interest did i pay",
      "how much have i paid in interest",
    ]) {
      expect(kind(text)).toEqual({ kind: "card_interest" });
    }
  });

  it("isn't a loan's interest", () => {
    expect(kind("how much interest did i pay on my student loan").kind).not.toBe("card_interest");
  });
});

describe("what happened with something", () => {
  it("is about that thing", () => {
    expect(kind("what happened with target?")).toEqual({ kind: "about", target: "target" });
    expect(kind("what happened at target")).toEqual({ kind: "about", target: "target" });
  });

  it("is still what Jane did when nothing is named", () => {
    expect(kind("what happened?").kind).toBe("what_did");
    expect(kind("what happened this week").kind).toBe("what_did");
  });
});
