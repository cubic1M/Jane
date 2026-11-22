import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { buildProfile, type ProfileInput, type ProfileTx } from "@/profile/build";
import { runDetectors } from "./index";

// Debug 2, sweep 16 (11-22): the bank-fees card's "See the fees" opened /insights, Where your money
// goes, which lists categories, not the fees it counted. Only the detector, as it stands on main, so
// this fails there (bank-fees-list.test.ts has the list).

const tx = (date: string, amountCents: number, description: string, pfc: string): ProfileTx => ({
  date,
  amountCents,
  description,
  pfc,
  accountId: "chk",
});

const data: ProfileInput = {
  today: "2026-11-21",
  accounts: [
    {
      id: "chk",
      type: "depository",
      subtype: "checking",
      balanceCents: 141_222,
      balanceKnown: true,
    },
  ],
  liabilities: [],
  told: {},
  transactions: [
    tx("2025-11-28", -62_525, "UNIV OF CALIF PAYROLL", "INCOME_WAGES"),
    tx("2026-03-12", 3_500, "OVERDRAFT FEE FOR A $4.50 ITEM", "BANK_FEES_OVERDRAFT_FEES"),
    tx("2026-06-18", 3_500, "OVERDRAFT FEE FOR A $12.10 ITEM", "BANK_FEES_OVERDRAFT_FEES"),
    tx("2026-11-13", -62_525, "UNIV OF CALIF PAYROLL", "INCOME_WAGES"),
  ],
};

describe("the bank-fees card's See the fees", () => {
  it("opens the list of the fees it counts, not the spending page", () => {
    const card = runDetectors({ profile: buildProfile(data), data }).find(
      (s) => s.topic === "bank_fees",
    );
    expect(card?.short).toBe("You paid $70.00 in 2 bank fees in a year.");
    expect(card?.action?.href).toBe("/transactions?fees=1");
  });
});
