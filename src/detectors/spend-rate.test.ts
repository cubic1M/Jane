import { describe, expect, it } from "vitest";
import type { ProfileInput, ProfileTx } from "@/profile/build";
import { monthlySpendCents } from "./helpers";

// Night QA 10-30: a freelancer's statements ran Aug 1 to Oct 26. The calendar count called that
// 2 months, so spending read about 40% high beside income (spread over the real span) and the
// emergency cushion came out at $51,771.18.

const tx = (date: string, amountCents: number): ProfileTx => ({
  date,
  amountCents,
  description: "OAK RIDGE APTS",
  pfc: "RENT_AND_UTILITIES_RENT",
  accountId: "chk",
});
const input = (transactions: ProfileTx[], today: string): ProfileInput => ({
  today,
  transactions,
  accounts: [],
  liabilities: [],
  told: {},
});

describe("monthlySpendCents", () => {
  it("spreads a short history over its real span, not the calendar count", () => {
    // $2,000 on the 1st of Aug, Sep and Oct, seen through Oct 30: 91 days, about 3 months.
    const data = input(
      [tx("2026-08-01", 200_000), tx("2026-09-01", 200_000), tx("2026-10-01", 200_000)],
      "2026-10-30",
    );
    const monthly = monthlySpendCents(data, 2);
    expect(monthly).toBeGreaterThan(190_000);
    expect(monthly).toBeLessThan(205_000);
  });

  it("is nothing with no history", () => {
    expect(monthlySpendCents(input([], "2026-10-30"), 0)).toBe(0);
  });
});
