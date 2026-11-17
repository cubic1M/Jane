import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { buildProfile, type ProfileInput, type ProfileTx } from "@/profile/build";
import { runDetectors } from "./index";

// Debug 2, third desktop sweep (11-16, upload S5: one month of Wells Fargo checking with one
// overdraft): Spending's "Bank fees you can stop" read "You paid $35.00 in 1 bank fees in 1
// months." One fee in one month is said as one.

const tx = (date: string, amountCents: number, description: string, pfc: string): ProfileTx => ({
  date,
  amountCents,
  description,
  pfc,
  accountId: "chk",
});

const data: ProfileInput = {
  today: "2026-11-16",
  accounts: [
    {
      id: "chk",
      type: "depository",
      subtype: "checking",
      balanceCents: 64_218,
      balanceKnown: true,
    },
  ],
  liabilities: [],
  told: {},
  transactions: [
    tx("2026-10-16", -71_250, "CAMPUS DINING PAYROLL PPD", "INCOME_WAGES"),
    tx("2026-10-28", 3_500, "OVERDRAFT FEE FOR A $6.20 ITEM", "BANK_FEES_OVERDRAFT_FEES"),
    tx("2026-10-30", -70_980, "CAMPUS DINING PAYROLL PPD", "INCOME_WAGES"),
    tx("2026-11-01", 85_000, "VENMO PAYMENT 1023 RENT ALEX K", "RENT_AND_UTILITIES_RENT"),
    tx("2026-11-13", -72_110, "CAMPUS DINING PAYROLL PPD", "INCOME_WAGES"),
  ],
};

describe("one bank fee", () => {
  it("is said as one", () => {
    const fees = runDetectors({ profile: buildProfile(data), data }).find(
      (s) => s.topic === "bank_fees",
    );
    expect(fees?.short).toBe("You paid $35.00 in 1 bank fee in 1 month.");
    expect(fees?.why).toMatch(/^You paid 1 bank fee in 1 month, about \$35\.00 over a year/);
  });
});
