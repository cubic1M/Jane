import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { buildProfile, type ProfileInput, type ProfileTx } from "@/profile/build";
import { runDetectors } from "./index";

// Debug 2 (11-16, a student with $243.90 in checking, 1280 light): Yes on "Build an emergency
// cushion, protect $6,281" opened Savings goals with an empty "Add a goal" form, though the card
// had just said "3 months is $6,524.82". Yes now asks the goals page for the emergency fund drafted
// (src/app/goals/draft.ts), by name only: no amount in the address (#1807).

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

describe("the emergency cushion's Yes", () => {
  it("opens the goal form drafted as an emergency fund, with nothing personal in the address", () => {
    const card = runDetectors({ profile: buildProfile(data), data }).find(
      (s) => s.topic === "emergency_fund",
    );
    expect(card?.action.href).toBe("/goals?draft=emergency_fund");
    expect(card?.action.href).not.toMatch(/\d/);
  });
});
