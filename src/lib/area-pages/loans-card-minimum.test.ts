import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { loansTree } from "./loans";

// Debug 2, desktop sweep 7 (11-19, Plaid sandbox, 14 months): Loans & credit listed the card
// "Plaid credit card ····0082, $1.9k at 24.99%: $45 a month." for a card paid $200 a month. The
// $45 is the bank's minimum.

const debt = (kind: string, kindLabel: string) => ({
  key: kind,
  name: kindLabel,
  kind,
  kindLabel,
  balanceCents: 185_040,
  aprBps: 2_499,
  paymentCents: 4_500,
  nextDue: null,
  overdue: false,
  pastDueCents: null,
  inNetWorth: true,
});
const summary = (kind: string, kindLabel: string) =>
  loansTree({
    asOf: "2026-11-19",
    debts: [debt(kind, kindLabel)],
    suggestions: [],
    installments: 0,
    payoff: null,
    credit: null,
    review: null,
  }).summaries[`debts:${kind}`];

describe("a debt's payment on Loans & credit", () => {
  it("is a card's minimum", () => {
    expect(summary("card", "Credit card")).toBe("Minimum $45 a month.");
  });

  it("is what's paid on a loan", () => {
    expect(summary("auto", "Car loan")).toBe("$45 a month.");
  });
});
