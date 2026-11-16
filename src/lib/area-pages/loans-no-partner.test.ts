import { describe, expect, it } from "vitest";
import { loansTree, type LoansTreeInput } from "./loans";

// Debug 2 (11-16, a student with a Capital One card, 1280 light): Loans → Cheaper loans read
// "Refinance offers · Checked monthly: Jane checks rates for your loans and cards every month", and
// its link (like the page's "Refinance" and "See transfer offers") opened a page that said only
// "Offers come from a lending partner, and there isn't one for your accounts yet." Only the demo
// bank has a partner. Without one the item isn't listed.

const input = (refinance: boolean | undefined): LoansTreeInput => ({
  asOf: "2026-11-16",
  debts: [
    {
      key: "account:card",
      name: "Capital One card",
      kindLabel: "Credit card",
      balanceCents: 185_040,
      aprBps: null,
      paymentCents: null,
      nextDue: null,
      overdue: false,
      pastDueCents: null,
      inNetWorth: true,
    },
  ],
  suggestions: [],
  installments: 0,
  payoff: null,
  credit: null,
  review: null,
  refinance,
});

const ids = (refinance: boolean | undefined) =>
  loansTree(input(refinance)).tree.branches.flatMap((b) => b.items.map((i) => i.id));

describe("refinance offers on the Loans tree", () => {
  it("aren't said to be checked monthly without a lending partner", () => {
    expect(ids(false)).not.toContain("cheaper:checked");
  });

  it("are, with one", () => {
    expect(ids(true)).toContain("cheaper:checked");
  });
});
