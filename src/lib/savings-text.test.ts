import { describe, expect, it } from "vitest";
import { savingsLine, savingsPhrase } from "./savings-text";

describe("savings text", () => {
  it("reads yearly savings as a year and refunds as money back", () => {
    expect(savingsLine("bank_fees", 4_900)).toBe("Could save about $49.00 a year");
    expect(savingsLine("duplicate_charge", 4_999)).toBe("Could get back about $49.99");
    expect(savingsPhrase("trial_conversion", 1_299)).toBe("about $12.99 back");
    expect(savingsPhrase("price_increase", 3_000)).toBe("about $30.00 a year");
    // Idle cash earns its yearly amount.
    expect(savingsLine("idle_cash", 252_448)).toBe("Could earn about $2,524.48 a year");
    // Card interest says when its yearly amount is worked out from today's balance…
    expect(savingsLine("card_interest", 141_553, { interestFrom: "balance" })).toBe(
      "Could save about $1,415.53 a year at today's balance",
    );
    // …and not when it's the charges seen, a year's worth (an upload's card, balance unknown).
    expect(savingsLine("card_interest", 22_080, { months: 3 })).toBe(
      "Could save about $220.80 a year",
    );
    expect(savingsLine("card_interest", 22_080)).toBe("Could save about $220.80 a year");
  });

  it("explains a missing estimate", () => {
    expect(savingsLine("insurance_reshop", null)).toBe("Savings depend on the quotes we find");
    expect(savingsLine("low_balance_risk", null)).toBe("No dollar estimate for this one");
  });
});
