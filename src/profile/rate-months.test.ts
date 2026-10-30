import { describe, expect, it } from "vitest";
import { buildProfile, rateMonthsOf, type ProfileInput, type ProfileTx } from "./build";

// Night QA 10-30: statements from Aug 1 to Oct 26 are "2 months" by the calendar, so anything
// spread over profile.months (student-loan payments, insurance premiums, card interest, fees)
// read at 1.5 times its pace. Rates spread over the real span instead.

const tx = (date: string, amountCents: number, pfc: string): ProfileTx => ({
  date,
  amountCents,
  description: "PAYMENT",
  pfc,
  accountId: "chk",
});
const input = (transactions: ProfileTx[]): ProfileInput => ({
  today: "2026-10-26",
  transactions,
  accounts: [],
  liabilities: [],
  told: {},
});

describe("rateMonthsOf", () => {
  it("spreads a short history over its real span", () => {
    const profile = buildProfile(
      input(
        ["2026-08-01", "2026-09-01", "2026-10-01"].map((d) =>
          tx(d, 14_230, "GENERAL_SERVICES_INSURANCE"),
        ),
      ),
    );
    expect(profile.months).toBe(2);
    expect(rateMonthsOf(profile)).toBeGreaterThan(2.8);
    expect(rateMonthsOf(profile)).toBeLessThan(3);
    // Three monthly premiums are about a year of twelve, not eighteen.
    const yearly = Math.round(3 * 14_230 * (12 / Math.min(12, rateMonthsOf(profile))));
    expect(yearly).toBeLessThan(14_230 * 13);
  });

  it("falls back to the calendar count on a profile made by hand", () => {
    expect(rateMonthsOf({ months: 4 })).toBe(4);
    expect(rateMonthsOf({ months: 0 })).toBe(1);
  });
});
