import { describe, expect, it } from "vitest";
import { fplFor } from "@/config/health-taxes";
import { applicablePercent, hsaExcess, medicalDeduction, ptcCheck } from "./health-taxes";

// Spec step 269: the premium tax credit reconciled against real income, HSA contributions over
// the limit, and the medical deduction's floor.

const $ = (d: number) => Math.round(d * 100);

describe("the premium tax credit", () => {
  const plan = { householdSize: 1, benchmarkYearCents: $(7_200), advanceYearCents: $(4_200) };

  it("allows a credit at a modest income and asks nothing back", () => {
    const r = ptcCheck({ ...plan, incomeCents: $(30_000) });
    expect(r.overCliff).toBe(false);
    expect(r.allowedCents).toBeGreaterThan($(4_200));
    expect(r.repayCents).toBe(0);
  });

  it("raises a repayment warning when a mid-year rise passes 400% of the poverty line", () => {
    const line = fplFor(1);
    const before = ptcCheck({ ...plan, incomeCents: Math.round(line * 3.5) });
    const after = ptcCheck({ ...plan, incomeCents: Math.round(line * 4.2) });
    expect(before.overCliff).toBe(false);
    expect(before.repayCents).toBeLessThanOrEqual(before.capCents!);
    expect(after.overCliff).toBe(true);
    expect(after.allowedCents).toBe(0);
    // Over the cliff there is no cap: every advance dollar is repaid.
    expect(after.capCents).toBeNull();
    expect(after.repayCents).toBe($(4_200));
  });

  it("caps repayment under the cliff, by income and household", () => {
    const r = ptcCheck({
      incomeCents: Math.round(fplFor(1) * 3.9),
      householdSize: 1,
      benchmarkYearCents: $(2_000),
      advanceYearCents: $(9_000),
    });
    expect(r.capCents).toBe($(1_575));
    expect(r.repayCents).toBe($(1_575));
    const family = ptcCheck({
      incomeCents: Math.round(fplFor(3) * 3.9),
      householdSize: 3,
      benchmarkYearCents: $(2_000),
      advanceYearCents: $(9_000),
    });
    expect(family.capCents).toBe($(3_150));
  });

  it("reads the expected share of income off a table, rising with income", () => {
    expect(applicablePercent(1.0)).toBeCloseTo(0.021);
    expect(applicablePercent(1.75)).toBeGreaterThan(applicablePercent(1.5));
    expect(applicablePercent(3.5)).toBeCloseTo(0.0996);
  });

  it("grows the poverty line with the household", () => {
    expect(fplFor(1)).toBe($(15_650));
    expect(fplFor(3)).toBe($(15_650) + 2 * $(5_500));
  });
});

describe("HSA contributions", () => {
  it("catch what's over the limit, with the excise tax and the tax on the excess", () => {
    const r = hsaExcess({ contributedCents: $(6_000), limitCents: $(4_400), marginalRate: 0.32 });
    expect(r.excessCents).toBe($(1_600));
    expect(r.exciseCents).toBe($(96));
    expect(r.taxCents).toBe($(512));
    expect(
      hsaExcess({ contributedCents: $(4_400), limitCents: $(4_400), marginalRate: 0.32 })
        .excessCents,
    ).toBe(0);
  });
});

describe("the medical deduction", () => {
  it("counts only what's over 7.5% of income", () => {
    expect(medicalDeduction({ medicalCents: $(10_000), agiCents: $(80_000) })).toEqual({
      floorCents: $(6_000),
      deductibleCents: $(4_000),
    });
    expect(medicalDeduction({ medicalCents: $(3_000), agiCents: $(80_000) }).deductibleCents).toBe(
      0,
    );
  });
});
