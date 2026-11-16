import { describe, expect, it } from "vitest";
import type { Suggestion } from "@/detectors/contract";
import { mergeOverlaps, rankSuggestions, worthOnce } from "./suggestion-rank";

// Debug 2 (11-16, Plaid sandbox, a Capital One card with $1,850.40 owed, the dock at 1280 light):
// "Pay down the card charging interest, save $353/yr" and "Try a 0% balance transfer card, save
// $298/yr" side by side, both the interest on the one balance. A transfer saves the same card
// interest paying it down does, so it shares their money group: one is offered, counted once.

const make = (topic: Suggestion["topic"], worthCents: number, percent: number): Suggestion => ({
  id: `x:${topic}`,
  topic,
  capability: "debt",
  title: "t",
  headline: "t",
  short: "t",
  worthCents,
  worthKind: "saves",
  confidence: { percent, reason: "r" },
  urgency: "soon",
  why: "w $1",
  action: { label: "go", href: "/x" },
});

describe("a balance transfer beside the card interest it would save", () => {
  const interest = make("card_interest", 35_331, 95);
  const transfer = make("balance_transfer", 29_780, 83);

  it("is offered once, the stronger", () => {
    expect(
      mergeOverlaps(rankSuggestions([transfer, interest])).map((r) => r.suggestion.topic),
    ).toEqual(["card_interest"]);
  });

  it("adds up once", () => {
    expect(worthOnce([interest, transfer])).toBe(35_331);
  });
});
