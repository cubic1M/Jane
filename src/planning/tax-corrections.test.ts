import { describe, expect, it } from "vitest";
import { fixesFrom, incomePayers, payerKeyOf, type TaxCorrectionRow } from "./tax-corrections";

const row = (over: Partial<TaxCorrectionRow>): TaxCorrectionRow => ({
  id: "x",
  kind: "deduction",
  payerKey: null,
  label: "x",
  cents: null,
  paidTo: null,
  ...over,
});

describe("what a person pointed out", () => {
  it("leaves numbers nobody gave as null, not $0", () => {
    const fixes = fixesFrom([]);
    expect(fixes.wagesCents).toBeNull();
    expect(fixes.withheldCents).toBeNull();
    expect(fixes.selfEmployedCents).toBeNull();
    expect(fixes.keptApartCents).toBeNull();
  });

  it("keeps a given $0 as a figure", () => {
    expect(fixesFrom([row({ kind: "withheld", cents: 0 })]).withheldCents).toBe(0);
  });

  it("adds up deductions and costs, and splits payments by where they went", () => {
    const fixes = fixesFrom([
      row({ kind: "deduction", cents: 100 }),
      row({ kind: "deduction", cents: 200 }),
      row({ kind: "business_cost", cents: 50 }),
      row({ kind: "paid", cents: 70, paidTo: "federal" }),
      row({ kind: "paid", cents: 30, paidTo: "state" }),
    ]);
    expect(fixes.deductionCents).toBe(300);
    expect(fixes.businessCostCents).toBe(50);
    expect(fixes.paid).toEqual({ federalCents: 70, stateCents: 30 });
  });

  it("collects the payers that aren't income", () => {
    const fixes = fixesFrom([row({ kind: "not_income", payerKey: "mom" })]);
    expect(fixes.notIncome.has("mom")).toBe(true);
  });
});

describe("who paid the income", () => {
  it("groups a payer's deposits under one key, biggest first", () => {
    const payers = incomePayers([
      {
        amountCents: -100_00,
        description: "ACH CREDIT BRIGHTLEAF MEDIA",
        merchantName: "Brightleaf",
      },
      {
        amountCents: -50_00,
        description: "ACH CREDIT BRIGHTLEAF MEDIA",
        merchantName: "Brightleaf",
      },
      { amountCents: -300_00, description: "NORTHWIND PAYROLL", merchantName: null },
      { amountCents: 20_00, description: "NOT MONEY IN", merchantName: null },
    ]);
    expect(payers.map((p) => p.cents)).toEqual([300_00, 150_00]);
    expect(payers[1]?.key).toBe(payerKeyOf("ACH CREDIT BRIGHTLEAF MEDIA"));
  });
});
