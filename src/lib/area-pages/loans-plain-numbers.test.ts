import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { loansTree } from "./loans";

// Debugger 11-13, Loans & credit on a phone with the demo bank: a pay-in-4 plan paid every two
// weeks read "$62 a month"; "Installments coming: 3 this month" listed Dec 8 on Nov 13; and the
// pay-later suggestion read "Buy now, pay later due $572" over "You've paid $572.00".

const { tree, summaries } = loansTree({
  asOf: "2026-11-13",
  debts: [
    {
      key: "klarna",
      name: "Klarna Pay in 4",
      kindLabel: "Buy now, pay later",
      balanceCents: 12_450,
      aprBps: 0,
      paymentCents: 6_225,
      paymentEvery: "two_weeks",
      nextDue: "2026-11-24",
      overdue: false,
      pastDueCents: null,
      inNetWorth: false,
    },
    {
      key: "car",
      name: "Car Loan",
      kindLabel: "Car loan",
      balanceCents: 1_800_000,
      aprBps: 690,
      paymentCents: 42_000,
      nextDue: "2026-12-01",
      overdue: false,
      pastDueCents: null,
      inNetWorth: true,
    },
  ],
  suggestions: [
    {
      key: "debt:bnpl",
      topic: "bnpl",
      short: "You've paid $572.00 in 7 pay-later installments.",
      urgency: "later",
      worthCents: 57_200,
      worthKind: "paid",
    },
  ],
  installments: 3,
  payoff: null,
  credit: null,
  review: null,
});
const items = tree.branches.flatMap((b) => b.items);
const byId = (id: string) => items.find((i) => i.id === id);

describe("Loans & credit says its numbers as they are", () => {
  it("says a payment every two weeks as every two weeks, and a monthly one as a month", () => {
    expect(summaries["debts:klarna"]).toMatch(/^\$62(\.25)? every two weeks/);
    expect(summaries["debts:car"]).toMatch(/^\$420 a month/);
  });

  it("counts the installments over the next month, as it does", () => {
    expect(byId("debts:installments")?.figure).toBe("3 in the next month");
  });

  it("calls what's been paid on pay-later plans used, not due", () => {
    const bnpl = items.find((i) => i.id.endsWith(":bnpl"));
    expect(bnpl?.label).toBe("Buy now, pay later used");
  });
});
