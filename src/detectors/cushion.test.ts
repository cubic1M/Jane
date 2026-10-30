import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { EMERGENCY_FUND_MONTHS } from "@/config/proposals";
import { formatCents } from "@/lib/money";
import { buildProfile, type ProfileInput, type ProfileTx } from "@/profile/build";
import { cushionSpendCents } from "./helpers";
import { runDetectors } from "./index";

// Night QA 10-30: one person read "a cushion for you is $11,604.78" on the cushion card, a
// $11,296 cushion in the report's checkup and an "Emergency fund" goal of 3 months at
// $2,151.16 in the dock. The card, the chat and the goal now size it from one typical month.

const tx = (date: string, amountCents: number, description: string, pfc: string): ProfileTx => ({
  date,
  amountCents,
  description,
  pfc,
  accountId: "chk",
});

// Statements from Jul 28: four days of July, then August, September and most of October.
const months = ["2026-08", "2026-09", "2026-10"];
const data: ProfileInput = {
  today: "2026-10-25",
  accounts: [
    {
      id: "chk",
      type: "depository",
      subtype: "checking",
      balanceCents: 300_000,
      balanceKnown: true,
    },
  ],
  liabilities: [],
  told: {},
  transactions: [
    tx("2026-07-28", 4_000, "CORNER MARKET", "FOOD_AND_DRINK_GROCERIES"),
    ...months.flatMap((m) => [
      tx(`${m}-01`, 180_000, "OAK RIDGE APTS", "RENT_AND_UTILITIES_RENT"),
      // Plaid's older name for pay: still pay, never negative spending.
      tx(`${m}-03`, -400_000, "ACME PAYROLL", "INCOME_WAGES"),
      tx(`${m}-10`, 60_000, "CORNER MARKET", "FOOD_AND_DRINK_GROCERIES"),
    ]),
  ],
};

describe("the emergency cushion", () => {
  it("is sized from a typical month: full months only", () => {
    // August and September: $1,800 rent and $600 food. July's four days don't count.
    expect(cushionSpendCents(data, 3)).toBe(240_000);
  });

  it("names the same figure on the card as 3 typical months", () => {
    const card = runDetectors({ profile: buildProfile(data), data }).find(
      (s) => s.topic === "emergency_fund",
    );
    expect(card?.short).toContain(
      `a cushion for you is ${formatCents(EMERGENCY_FUND_MONTHS * 240_000)}`,
    );
  });
});
