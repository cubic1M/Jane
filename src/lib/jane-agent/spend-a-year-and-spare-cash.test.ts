import { describe, expect, it } from "vitest";
import { parseIntent } from "./intents";

// Debugger 11-17 (r330, Plaid sandbox checking with Spotify and an idle cash finding, chat on a
// phone): "how much do I spend on spotify a year?" answered "I couldn't find spending on "spotify
// a year"", and "should I move my extra cash somewhere?" answered "I can't answer that one yet".
// The first is what Spotify costs a year; the second is about the person's spare cash.

const TODAY = "2026-11-17";

describe("what something costs a year", () => {
  it("is the cost answer for a year", () => {
    expect(parseIntent("how much do I spend on spotify a year?", TODAY)).toEqual({
      kind: "cost",
      target: "spotify",
      year: true,
    });
    expect(parseIntent("how much do i spend on netflix per year", TODAY)).toMatchObject({
      kind: "cost",
      target: "netflix",
      year: true,
    });
  });

  it("leaves a named month alone", () => {
    expect(parseIntent("how much did i spend on spotify in october", TODAY).kind).toBe("spending");
  });
});

describe("spare cash", () => {
  it("is about the person's cash", () => {
    for (const text of [
      "should I move my extra cash somewhere?",
      "what should i do with my spare cash",
      "is my idle cash doing anything",
    ]) {
      expect(parseIntent(text, TODAY)).toEqual({ kind: "about", target: "cash" });
    }
  });
});
