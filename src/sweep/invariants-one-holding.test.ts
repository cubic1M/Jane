import { describe, expect, it } from "vitest";
import { twoCardsOneHolding } from "./invariants";

// Class 7's one-card rule: two suggestions never name the same fund in their short line (the fee
// card and the 401(k) menu card on one costly fund, debug 3, 11-19).

describe("one holding, one card", () => {
  it("fails two cards that name the same fund", () => {
    expect(
      twoCardsOneHolding({
        "suggestions.investing:investment_fees.short":
          "Northstar Target 2055 Fund ($84,000.00) costs more than a similar fund.",
        "suggestions.investing:plan_menu.short":
          "Your 401(k) holds Northstar Target 2055 Fund ($84,000.00); your plan offers cheaper.",
      }),
    ).toEqual([
      "Northstar Target 2055 Fund: one holding, 2 cards (investing:investment_fees, investing:plan_menu)",
    ]);
  });

  it("passes one card per fund, and a fund named only in a card's why", () => {
    expect(
      twoCardsOneHolding({
        "suggestions.investing:investment_fees.short":
          "Northstar Target 2055 Fund ($84,000.00) costs more than a similar fund.",
        "suggestions.investing:investment_fees.why":
          "Your 401(k)'s menu also has Keystone Target 2055 Index Fund (0.04% a year).",
        "suggestions.investing:rebalance.short":
          "Your mix leans further into stocks than your plan.",
      }),
    ).toEqual([]);
  });
});
