import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { EMERGENCY_FUND_MONTHS } from "@/config/proposals";
import { formatCents } from "@/lib/money";
import { buildProfile, type ProfileInput, type ProfileTx } from "@/profile/build";
import { spendingMonthOf } from "@/planning/idle-cash";
import { cushionSpendCents } from "./helpers";
import { runDetectors } from "./index";

// Night QA 10-30: one person read "a cushion for you is $11,604.78" on the cushion card, a
// $11,296 cushion in the report's checkup and an "Emergency fund" goal of 3 months at
// $2,151.16 in the dock. The card, the chat, the goal and idle cash now size it from one month of
// spending (src/planning/idle-cash.ts spendingMonthOf; gate B, 11-16: idle cash and the goal said
// $1,423.98 and $1,273.14 a month in one dock).

const tx = (date: string, amountCents: number, description: string, pfc: string): ProfileTx => ({
  date,
  amountCents,
  description,
  pfc,
  accountId: "chk",
});

// Statements from Jul 28: four days of July, then August, September and October to the 10th, read
// on the 11th.
const months = ["2026-08", "2026-09", "2026-10"];
const data: ProfileInput = {
  today: "2026-10-11",
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
  // What was spent from the first purchase to today ($40 in July, then $1,800 rent and $600 food
  // each month), over the days between, as idle cash counts it: one figure for both cards.
  const month = Math.round((4_000 + 3 * 240_000) / (75 / (365.25 / 12)));

  it("is a month of spending by the days the data covers, as idle cash counts it", () => {
    expect(cushionSpendCents(data)).toBe(month);
    expect(
      spendingMonthOf({ asOf: data.today, transactions: data.transactions }).monthlyCents,
    ).toBe(month);
  });

  it("names the same figure on the card as 3 months of it", () => {
    const card = runDetectors({ profile: buildProfile(data), data }).find(
      (s) => s.topic === "emergency_fund",
    );
    expect(card?.short).toContain(
      `a cushion for you is ${formatCents(EMERGENCY_FUND_MONTHS * month)}`,
    );
  });
});
