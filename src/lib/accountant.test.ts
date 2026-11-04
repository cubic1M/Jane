import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { accountantSummaryRows } from "./accountant";

// Debugger 11-04: an accountant's link told them a teacher had "Already paid $0.00, Owed $1,108.68"
// when Jane sees only take-home pay and can't know what was withheld, as /taxes says.
describe("the figures an accountant reads", () => {
  const summary = {
    totalIncomeCents: 2_718_676,
    agiCents: 2_718_676,
    taxableCents: 1_108_676,
    totalTaxCents: 110_868,
    paidCents: 0,
    refundCents: -110_868,
  };
  const labels = (rows: readonly (readonly [string, number])[]) => rows.map(([label]) => label);

  it("says nothing of paid or owed when what was withheld isn't known", () => {
    expect(labels(accountantSummaryRows({ ...summary, withholdingKnown: false }))).toEqual([
      "Total income",
      "Adjusted gross income",
      "Taxable income",
      "Tax",
    ]);
  });

  it("gives them when it is", () => {
    expect(accountantSummaryRows({ ...summary, withholdingKnown: true }).slice(-2)).toEqual([
      ["Already paid", 0],
      ["Owed", 110_868],
    ]);
    expect(
      accountantSummaryRows({ ...summary, refundCents: 5_000, withholdingKnown: true }).at(-1),
    ).toEqual(["Refund", 5_000]);
  });
});
