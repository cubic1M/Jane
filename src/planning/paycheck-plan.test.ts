import { describe, expect, it } from "vitest";
import { paycheckPlan, type PaycheckPlanInput } from "./paycheck-plan";

// Spec step 144: where a paycheck goes, never touching money safe to spend needs.

const base: PaycheckPlanInput = {
  paycheckCents: 245_000,
  paychecksPerMonth: 2,
  checkingAccountId: "chk",
  savingsAccount: { id: "sav", name: "Savings" },
  accountNames: { chk: "Checking", sav: "Savings", sav2: "Trip Savings" },
  balanceCents: 400_000,
  billsCents: 150_000,
  budgetsLeftCents: 50_000,
  safeCents: 100_000,
  cushionCents: 10_000,
  goals: [
    { id: "g1", name: "Emergency fund", monthlyCents: 40_000, accountId: null, onTheWay: true },
    { id: "g2", name: "Trip", monthlyCents: 30_001, accountId: "sav2", onTheWay: true },
    {
      id: "g3",
      name: "Taxes set aside for 2026",
      monthlyCents: 20_000,
      accountId: null,
      onTheWay: true,
    },
    { id: "g4", name: "Done goal", monthlyCents: 0, accountId: null, onTheWay: false },
  ],
  debt: { accountId: "card", name: "Demo Credit Card", extraCents: 20_000 },
};

describe("paycheckPlan", () => {
  it("moves each goal's share per paycheck to its account, and the debt extra", () => {
    const plan = paycheckPlan(base);
    expect(plan.moves.map((m) => [m.label, m.toAccountId, m.cents, m.sector, m.needs])).toEqual([
      ['"Emergency fund"', "sav", 20_000, "goals", "safe"],
      ['"Trip"', "sav2", 15_001, "goals", "safe"],
      ['"Taxes set aside for 2026"', "sav", 10_000, "taxes", "safe"],
      ["extra toward Demo Credit Card", "card", 10_000, "debt", "all"],
    ]);
    expect(plan.movedCents).toBe(55_001);
    expect(plan.heldBack).toBeNull();
    expect(plan.billsCents).toBe(150_000);
  });

  it("never moves what bills, budgets and the cushion need", () => {
    // Only $60 left after bills, budgets and the cushion.
    const plan = paycheckPlan({ ...base, balanceCents: 216_000, safeCents: 5_000 });
    expect(plan.movedCents).toBeLessThanOrEqual(216_000 - 150_000 - 50_000 - 10_000);
    expect(plan.moves.map((m) => m.cents)).toEqual([6_000]);
    // The debt extra needs safe to spend itself above the cushion: none.
    expect(plan.moves.some((m) => m.purpose === "debt")).toBe(false);
    expect(plan.heldBack).toBe("cushion");
  });

  it("never moves more than the paycheck, nor tiny amounts, nor to checking", () => {
    const small = paycheckPlan({ ...base, paycheckCents: 25_000 });
    expect(small.movedCents).toBeLessThanOrEqual(25_000);
    expect(small.heldBack).toBe("paycheck");
    const none = paycheckPlan({
      ...base,
      savingsAccount: null,
      debt: null,
      goals: [{ id: "g", name: "Tiny", monthlyCents: 600, accountId: null, onTheWay: true }],
    });
    expect(none.moves).toEqual([]);
    const toChecking = paycheckPlan({
      ...base,
      debt: null,
      goals: [{ id: "g", name: "Odd", monthlyCents: 40_000, accountId: "chk", onTheWay: true }],
    });
    expect(toChecking.moves).toEqual([]);
  });
});
