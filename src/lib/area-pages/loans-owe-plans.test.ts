import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { loansIntro } from "./loans";

// Debugger 11-13, the same demo person: Loans said "You owe $351,300.00" and the chat's net worth
// "owe $351,175.50". The $124.50 is a pay-in-4 plan, which Loans counts and net worth leaves out.
// Loans says its part, so the two figures meet.

const debt = (balanceCents: number | null, inNetWorth = true) => ({ balanceCents, inNetWorth });

describe("the Loans page's line under its title", () => {
  it("says how much of what's owed is on pay-later plans", () => {
    expect(
      loansIntro({
        debts: [debt(35_117_550), debt(12_450, false)],
        totalOwedCents: 35_130_000,
        monthlyCents: 304_891,
      }),
    ).toBe(
      "You owe $351,300.00, $124.50 of it on pay-later plans, $3,048.91 due each month. Open a branch to see more.",
    );
  });

  it("says nothing more without plans, or when everything is on plans", () => {
    expect(loansIntro({ debts: [debt(240_000)], totalOwedCents: 240_000, monthlyCents: 0 })).toBe(
      "You owe $2,400.00. Open a branch to see more.",
    );
    expect(
      loansIntro({ debts: [debt(12_450, false)], totalOwedCents: 12_450, monthlyCents: 6_225 }),
    ).toBe("You owe $124.50, $62.25 due each month. Open a branch to see more.");
  });

  it("keeps the empty and unknown lines", () => {
    expect(loansIntro({ debts: [], totalOwedCents: 0, monthlyCents: 0 })).toBe(
      "No loans, cards or plans yet.",
    );
    expect(loansIntro({ debts: [debt(null)], totalOwedCents: 0, monthlyCents: 0 })).toMatch(
      /^Your files don't say what you owe yet/,
    );
  });
});
