import { describe, expect, it } from "vitest";
import { loansIntro } from "./loans";

// Debug 2 re-walk (11-16, Plaid sandbox default user, 1280 light): Loans' first line read "You owe
// $27,500.00, $25.00 due each month." for six debts, five of them with no payment known (only the
// student loan's $25 minimum came from the bank). It says "at least" until every payment is known.

const debts = Array.from({ length: 6 }, () => ({ balanceCents: 450_000, inNetWorth: true }));

describe("what's due each month on Loans", () => {
  it("says at least while some payments aren't known", () => {
    expect(
      loansIntro({ debts, totalOwedCents: 2_750_000, monthlyCents: 2_500, missingMonthly: 5 }),
    ).toBe("You owe $27,500.00, at least $25.00 due each month. Open a branch to see more.");
  });

  it("says the sum plainly once every payment is known", () => {
    expect(
      loansIntro({ debts, totalOwedCents: 2_750_000, monthlyCents: 61_500, missingMonthly: 0 }),
    ).toBe("You owe $27,500.00, $615.00 due each month. Open a branch to see more.");
  });
});
