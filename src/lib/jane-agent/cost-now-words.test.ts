import { describe, expect, it } from "vitest";
import { parseIntent } from "./intents";

// Debugger 11-17 (Plaid sandbox, 14 months, phone): "how much is netflix now?" read "I couldn't find
// spending on "netflix now"": the word for when stayed in the name.

const intent = (text: string) => parseIntent(text, "2026-11-16");

describe("a cost asked about now", () => {
  it("is the thing, not the thing plus the time", () => {
    for (const text of [
      "how much is netflix now?",
      "how much is netflix right now",
      "how much is netflix these days",
      "how much is netflix currently",
    ]) {
      expect(intent(text), text).toEqual({ kind: "cost", target: "netflix", year: false });
    }
  });

  it("leaves names that only end like a time word alone", () => {
    expect(intent("how much is snow now")).toEqual({ kind: "cost", target: "snow", year: false });
  });
});
