import { describe, expect, it } from "vitest";
import { findRefunds, matchRefund, refundPlan } from "./tax-refund";

// Spec step 125: spotting a refund, matching it to the estimate, and where it could go.

const dep = (o: Partial<Parameters<typeof findRefunds>[0][number]>) => ({
  id: "t",
  date: "2026-04-10",
  amountCents: -320_000,
  description: "IRS TREAS 310 TAX REF",
  merchantName: null,
  pfcDetailed: "INCOME_TAX_REFUND",
  ...o,
});

describe("findRefunds", () => {
  it("finds federal and state refunds, for the year before they land, newest first", () => {
    expect(
      findRefunds([
        dep({ id: "fed" }),
        dep({
          id: "ca",
          date: "2026-05-02",
          description: "FRANCHISE TAX BD CASTTAXRFD",
          pfcDetailed: null,
          amountCents: -41_000,
        }),
        dep({ id: "pay", description: "ACME PAYROLL", pfcDetailed: "INCOME_SALARY" }),
        dep({ id: "out", amountCents: 5_000 }),
      ]),
    ).toEqual([
      { transactionId: "ca", date: "2026-05-02", cents: 41_000, to: "state", taxYear: 2025 },
      { transactionId: "fed", date: "2026-04-10", cents: 320_000, to: "federal", taxYear: 2025 },
    ]);
  });
});

describe("matchRefund", () => {
  it("matches within $50 or 5%", () => {
    expect(matchRefund(320_000, 310_000)).toEqual({
      estimatedCents: 310_000,
      diffCents: 10_000,
      matches: true,
    });
    expect(matchRefund(320_000, 250_000)).toMatchObject({ diffCents: 70_000, matches: false });
    expect(matchRefund(10_000, 6_000)).toMatchObject({ matches: true });
    expect(matchRefund(10_000, null)).toBeNull();
  });
});

describe("refundPlan", () => {
  it("fills the emergency fund, then high-rate debt, then goals; the rest is the person's", () => {
    const plan = refundPlan({
      cents: 500_000,
      emergency: { targetCents: 1_000_000, haveCents: 800_000 },
      debts: [
        { accountName: "Low Card", balanceCents: 100_000, aprBps: 500 },
        { accountName: "Demo Credit Card", balanceCents: 241_050, aprBps: 2299 },
      ],
      goals: [
        { id: "g1", name: "Trip", leftCents: 30_000, behind: true },
        { id: "g2", name: "Done", leftCents: 0, behind: false },
      ],
    });
    expect(plan.items.map((i) => [i.kind, i.cents, i.label])).toEqual([
      ["emergency", 200_000, "your emergency fund"],
      ["debt", 241_050, "the Demo Credit Card (22.99%)"],
      ["goal", 30_000, 'your "Trip" goal'],
    ]);
    expect(plan.leftCents).toBe(500_000 - 200_000 - 241_050 - 30_000);
  });

  it("stops when the refund runs out", () => {
    const plan = refundPlan({
      cents: 100_000,
      emergency: { targetCents: 1_000_000, haveCents: 0 },
      debts: [{ accountName: "Card", balanceCents: 50_000, aprBps: 2000 }],
      goals: [],
    });
    expect(plan).toEqual({
      items: [{ kind: "emergency", cents: 100_000, label: "your emergency fund" }],
      leftCents: 0,
    });
  });
});
