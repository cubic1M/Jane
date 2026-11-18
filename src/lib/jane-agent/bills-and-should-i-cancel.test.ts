import { describe, expect, it } from "vitest";
import { parseIntent } from "./intents";

// Debugger 11-17 (r338, a Plaid sandbox checking account with rent, Netflix, Spotify and a phone
// bill, chat on a phone): "what are my bills this month?" and "should i cancel spotify?" both
// answered "I can't answer that one yet", though "what bills are coming up" lists the bills and
// "tell me about spotify" answers with its finding.

const TODAY = "2026-11-17";
const kind = (text: string) => parseIntent(text, TODAY);

describe("a person's bills", () => {
  it("is what's coming up", () => {
    for (const text of [
      "what are my bills this month?",
      "what are my bills",
      "what bills do i have",
    ]) {
      expect(kind(text).kind).toBe("coming_up");
    }
  });
});

describe("should I cancel a subscription", () => {
  it("is about that subscription", () => {
    expect(kind("should i cancel spotify?")).toEqual({ kind: "about", target: "spotify" });
    expect(kind("should i keep netflix")).toEqual({ kind: "about", target: "netflix" });
  });

  it("still cancels when told to", () => {
    expect(kind("cancel spotify").kind).toBe("act");
  });
});
