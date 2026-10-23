import { describe, expect, it } from "vitest";
import { ASSUMED_BENCHMARK_MONTHLY_CENTS, fplFor } from "@/config/health-taxes";
import {
  applicablePercent,
  benchmarkYear,
  creditAt,
  hsaExcess,
  hsaLimitFor,
  incomeByMonth,
  incomePace,
  medicalDeduction,
  ptcCheck,
} from "./health-taxes";

// Spec step 269: the premium tax credit reconciled against real income, HSA deposits over the
// limit, and the medical deduction's floor.

const $ = (d: number) => Math.round(d * 100);

describe("the premium tax credit", () => {
  const plan = { year: 2026, householdSize: 1, benchmarkYearCents: $(7_500) };

  it("reads the expected share of income off the 2026 table", () => {
    expect(applicablePercent(1.0)).toBeCloseTo(0.021);
    // A band starts at its first figure and rises evenly to its last.
    expect(applicablePercent(1.34)).toBeCloseTo(0.0316, 3);
    expect(applicablePercent(1.75)).toBeCloseTo((0.0419 + 0.066) / 2, 4);
    expect(applicablePercent(3.5)).toBeCloseTo(0.0996);
  });

  it("grows the poverty line with the household", () => {
    expect(fplFor(1)).toBe($(15_650));
    expect(fplFor(3)).toBe($(15_650) + 2 * $(5_500));
  });

  it("allows the benchmark less the expected share, and nothing over 400%", () => {
    expect(creditAt($(40_000), 1, $(7_500))).toBe(
      $(7_500) - Math.round($(40_000) * applicablePercent(40_000 / 15_650)),
    );
    expect(creditAt(Math.round(fplFor(1) * 4.01), 1, $(7_500))).toBe(0);
  });

  it("asks nothing back when income stays where it was at enrollment", () => {
    const advance = creditAt($(46_000), 1, plan.benchmarkYearCents);
    const r = ptcCheck({ ...plan, incomeCents: $(46_000), advanceYearCents: advance });
    expect(r.repayCents).toBe(0);
    expect(r.overCliff).toBe(false);
  });

  it("raises a repayment when income rises, all of it past 400% with no cap from 2026", () => {
    const advance = creditAt($(46_000), 1, plan.benchmarkYearCents);
    const partway = ptcCheck({ ...plan, incomeCents: $(58_000), advanceYearCents: advance });
    expect(partway.overCliff).toBe(false);
    expect(partway.repayCents).toBe(advance - partway.allowedCents);
    expect(partway.capCents).toBeNull();
    const past = ptcCheck({ ...plan, incomeCents: $(66_000), advanceYearCents: advance });
    expect(past.overCliff).toBe(true);
    expect(past.allowedCents).toBe(0);
    expect(past.repayCents).toBe(advance);
  });

  it("caps repayment under the cliff in years that have caps (2025)", () => {
    const r = ptcCheck({
      year: 2025,
      incomeCents: Math.round(fplFor(1) * 3.9),
      householdSize: 1,
      benchmarkYearCents: $(2_000),
      advanceYearCents: $(9_000),
    });
    expect(r.capCents).toBe($(1_575));
    expect(r.repayCents).toBe($(1_575));
  });

  it("assumes a benchmark per adult, children at half, unless told", () => {
    expect(benchmarkYear({ adults: 1, children: 0 }, null)).toBe(
      ASSUMED_BENCHMARK_MONTHLY_CENTS * 12,
    );
    expect(benchmarkYear({ adults: 2, children: 2 }, null)).toBe(
      ASSUMED_BENCHMARK_MONTHLY_CENTS * 36,
    );
    expect(benchmarkYear({ adults: 1, children: 0 }, $(500))).toBe($(6_000));
  });
});

describe("income through the year", () => {
  it("projects the rest of the year at the recent pace, so a mid-year rise shows", () => {
    const flat = Array<number>(12).fill($(4_000));
    expect(incomePace(flat, 10)).toMatchObject({
      enrollmentCents: $(48_000),
      projectedCents: $(48_000),
      rise: 1,
    });
    const rising = flat.map((c, i) => (i >= 6 ? c + $(3_000) : c));
    const p = incomePace(rising, 10);
    expect(p.enrollmentCents).toBe($(48_000));
    // Jan to Sep as they were ($45,000), then three more months at $7,000.
    expect(p.projectedCents).toBe($(66_000));
    expect(p.recentMonthlyCents).toBe($(7_000));
    expect(p.rise).toBeCloseTo(1.75);
  });

  it("reads income deposits by month, at the share given", () => {
    const rows = [
      { date: "2026-01-04", amountCents: -$(1_000), pfc: "INCOME_CONTRACTOR" },
      { date: "2026-01-20", amountCents: -$(500), pfc: "TRANSFER_IN_ACCOUNT_TRANSFER" },
      { date: "2025-12-04", amountCents: -$(1_000), pfc: "INCOME_CONTRACTOR" },
      { date: "2026-03-04", amountCents: $(80), pfc: "INCOME_CONTRACTOR" },
    ];
    const months = incomeByMonth(rows, 2026, 0.85);
    expect(months[0]).toBe($(850));
    expect(months.reduce((s, x) => s + x, 0)).toBe($(850));
  });
});

describe("HSA deposits", () => {
  it("catch what's over the limit now and by December, with the 6% excise", () => {
    const r = hsaExcess({
      contributedCents: $(5_000),
      projectedCents: $(6_000),
      limitCents: $(4_400),
    });
    expect(r.excessCents).toBe($(600));
    expect(r.projectedExcessCents).toBe($(1_600));
    expect(r.exciseCents).toBe($(96));
    expect(r.roomCents).toBe(0);
    const under = hsaExcess({
      contributedCents: $(2_000),
      projectedCents: $(4_400),
      limitCents: $(4_400),
    });
    expect(under.projectedExcessCents).toBe(0);
    expect(under.roomCents).toBe($(2_400));
  });

  it("use the family limit for a couple, plus the catch-up from 55", () => {
    expect(hsaLimitFor(false, 40)).toBe($(4_400));
    expect(hsaLimitFor(true, null)).toBe($(8_750));
    expect(hsaLimitFor(false, 56)).toBe($(5_400));
  });
});

describe("the medical deduction", () => {
  it("counts only what's over 7.5% of income, and saves only past the standard deduction", () => {
    const r = medicalDeduction({
      medicalCents: $(25_000),
      agiCents: $(54_000),
      otherItemizedCents: $(2_800),
      standardCents: $(18_150),
      marginalRate: 0.12,
    });
    expect(r.floorCents).toBe($(4_050));
    expect(r.deductibleCents).toBe($(20_950));
    expect(r.itemizing).toBe(true);
    expect(r.savesCents).toBe(Math.round(($(20_950) + $(2_800) - $(18_150)) * 0.12));
  });

  it("saves nothing when the standard deduction is still bigger", () => {
    const r = medicalDeduction({
      medicalCents: $(10_000),
      agiCents: $(80_000),
      otherItemizedCents: $(3_000),
      standardCents: $(16_100),
      marginalRate: 0.22,
    });
    expect(r.deductibleCents).toBe($(4_000));
    expect(r.itemizing).toBe(false);
    expect(r.savesCents).toBe(0);
    expect(
      medicalDeduction({
        ...{ medicalCents: $(3_000), agiCents: $(80_000) },
        otherItemizedCents: 0,
        standardCents: $(16_100),
        marginalRate: 0.22,
      }).toFloorCents,
    ).toBe($(3_000));
  });
});
