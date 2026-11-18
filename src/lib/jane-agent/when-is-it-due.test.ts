import { describe, expect, it } from "vitest";
import { parseIntent } from "./intents";

// Debugger 11-17 (r329, Plaid sandbox, one month of checking with rent by Zelle, chat on a phone):
// "when is rent due?" answered "I can't answer that one yet". "When is X due" is what X costs and
// when it's next charged (the cost answer has the date, and asks about rent sent to a person).

const TODAY = "2026-11-17";

describe("when is something due", () => {
  it("is the cost answer for that thing", () => {
    for (const [text, target] of [
      ["when is rent due?", "rent"],
      ["when is my rent due", "rent"],
      ["when is netflix due", "netflix"],
      ["when's my phone bill due", "phone"],
      ["when do i pay rent", "rent"],
    ]) {
      expect(parseIntent(text, TODAY)).toEqual({ kind: "cost", target, year: false, when: true });
    }
  });

  it("is still the coming-up list for bills in general", () => {
    expect(parseIntent("when are my bills due", TODAY).kind).toBe("coming_up");
    expect(parseIntent("when are my payments due", TODAY).kind).toBe("coming_up");
  });
});
