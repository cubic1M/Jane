import { describe, expect, it } from "vitest";
import { tuneUpChanges } from "./tune-up";

// Spec step 101: a budget is tuned only when its usual month moved well away from it.

describe("tuneUpChanges", () => {
  const budgets = [
    { category: "Shopping", amountCents: 20_000 },
    { category: "Food and drink", amountCents: 40_000 },
    { category: "Travel", amountCents: 50_000 },
    { category: "Home", amountCents: 10_000 },
  ];

  it("moves budgets toward a usual month that changed, up or down", () => {
    const suggestions = {
      "Food and drink": 47_000,
      Shopping: 15_000,
      // Within 10%: left alone.
      Travel: 52_000,
      // Over 10% but under $20: left alone.
      Home: 11_500,
    };
    expect(tuneUpChanges({ suggestions }, budgets)).toEqual([
      { category: "Food and drink", fromCents: 40_000, toCents: 47_000 },
      { category: "Shopping", fromCents: 20_000, toCents: 15_000 },
    ]);
  });

  it("leaves a budget with no spending history alone", () => {
    expect(tuneUpChanges({ suggestions: { Shopping: 0 } }, budgets)).toEqual([]);
    expect(tuneUpChanges({ suggestions: {} }, budgets)).toEqual([]);
  });
});
