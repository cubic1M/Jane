import { describe, expect, it } from "vitest";
import { loansTree } from "./loans";

// Debugger 11-17 (r335, a Bank of America checking file and a Chase card file on a phone, the
// card's balance skipped): Loans & credit's "Your debts" read "Good: Chase card, Not known", next
// to "Costing you now" with $84.81 of that card's interest. What's owed isn't known, so it needs a
// look, as Taxes' "Tax not yet paid, Not known" does; a debt with its balance stays good.

const debts = (balanceCents: number | null) =>
  loansTree({
    asOf: "2026-11-17",
    debts: [
      {
        key: "account:chase",
        name: "Chase card",
        kindLabel: "Credit card",
        balanceCents,
        aprBps: null,
        paymentCents: null,
        nextDue: null,
        overdue: false,
        pastDueCents: null,
        inNetWorth: balanceCents !== null,
      },
    ],
    suggestions: [],
    installments: 0,
    payoff: null,
    credit: null,
    review: null,
    refinance: false,
  }).tree.branches.find((b) => b.id === "debts");

describe("a debt in Loans & credit", () => {
  it("needs a look while what's owed isn't known", () => {
    expect(debts(null)?.items.map((i) => [i.label, i.status, i.figure])).toEqual([
      ["Chase card", "look", "Not known"],
    ]);
  });

  it("is good once it is", () => {
    expect(debts(124_000)?.items.map((i) => [i.label, i.status])).toEqual([["Chase card", "good"]]);
  });
});
