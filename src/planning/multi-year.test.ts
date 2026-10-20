import { describe, expect, it } from "vitest";
import { MIN_CONVERSION_CENTS, indexFactor } from "@/config/tax-years";
import { NO_INCOME, estimateTaxes, type EstimateInput } from "./tax-estimate";
import {
  findMoves,
  horizon,
  inputFor,
  lifetimeTax,
  project,
  taxFor,
  type Plan,
} from "./multi-year";

// Spec step 220: the projection's first year is the step 120 estimate; later years use the
// 2026 brackets scaled by config; every move's effect is the lifetime tax with it against
// without it.

const $ = (dollars: number) => Math.round(dollars * 100);

const base = (income: Partial<EstimateInput["income"]> = {}): EstimateInput => ({
  year: 2026,
  filingStatus: "single",
  childrenUnder17: 0,
  otherDependants: 0,
  state: null,
  income: { ...NO_INCOME, wagesCents: $(90_000), socialSecurityWagesCents: $(90_000), ...income },
  studentLoanInterestCents: 0,
  mortgageInterestCents: 0,
  charityCents: 0,
  medicalCents: 0,
  otherStateLocalTaxCents: 0,
  federalWithheldCents: $(9_000),
  federalEstimatedPaidCents: 0,
  stateWithheldCents: 0,
  stateEstimatedPaidCents: 0,
});

const plan = (over: Partial<Plan> = {}): Plan => ({
  startYear: 2026,
  base: base(),
  retireYear: 2036,
  traditionalCents: $(400_000),
  unrealisedLongTermCents: 0,
  events: [],
  ...over,
});

describe("the projection", () => {
  it("matches the estimate in the first year", () => {
    const p = plan({ base: base({ longTermGainsCents: $(5_000), interestCents: $(800) }) });
    const rows = project(p);
    expect(rows[0].year).toBe(2026);
    expect(rows[0].totalTaxCents).toBe(estimateTaxes(p.base).totalTaxCents);
    expect(taxFor(p, 2026).taxableCents).toBe(estimateTaxes(p.base).taxableCents);
  });

  it("scales the brackets by the config's factor, so unchanged real income pays the same real tax", () => {
    // Retired, nothing happening: a year with 2026-dollar income scaled up is taxed at the
    // same rate as 2026.
    const p = plan({ base: base(), retireYear: 2040, traditionalCents: 0 });
    const f = indexFactor(2030) / indexFactor(2026);
    const input = inputFor(p, 2030);
    expect(input.income.wagesCents).toBe(Math.round($(90_000) * 1.03 ** 4));
    const real = project({
      ...p,
      base: base({ wagesCents: Math.round(input.income.wagesCents / f) }),
    })[0];
    expect(taxFor(p, 2030).totalTaxCents).toBeGreaterThan(0);
    expect(
      Math.abs(taxFor(p, 2030).totalTaxCents - Math.round(real.totalTaxCents * f)),
    ).toBeLessThan(5);
  });

  it("stops pay at retirement and withdraws the account evenly after", () => {
    const p = plan();
    expect(inputFor(p, 2035).income.wagesCents).toBeGreaterThan(0);
    expect(inputFor(p, 2036).income.wagesCents).toBe(0);
    const w = inputFor(p, 2036).income.retirementCents;
    expect(w).toBeGreaterThan(0);
    expect(inputFor(p, 2040).income.retirementCents).toBe(w);
    expect(inputFor(p, 2056).income.retirementCents).toBe(0);
    expect(horizon(p)).toBe(30);
  });

  it("has a lower rate in retirement years with only withdrawals", () => {
    const rows = project(plan());
    expect(rows[10].marginalRate).toBeLessThan(rows[0].marginalRate + 0.0001);
  });
});

describe("the moves", () => {
  it("converts to a Roth in a low-income year, and the effect is the lifetime tax saved", () => {
    const p = plan({
      base: base({ wagesCents: 0, socialSecurityWagesCents: 0 }),
      retireYear: 2030,
      traditionalCents: $(2_000_000),
    });
    const rows = project(p);
    const moves = findMoves(p, rows).filter((m) => m.kind === "roth");
    expect(moves.length).toBeGreaterThan(0);
    for (const m of moves) {
      expect(m.amountCents).toBeGreaterThanOrEqual(MIN_CONVERSION_CENTS);
      expect(m.effectCents).toBe(lifetimeTax(rows) - lifetimeTax(project(p, m.adjust)));
    }
  });

  it("realises gains in the 0% bracket", () => {
    const p = plan({
      base: base({ wagesCents: $(20_000), socialSecurityWagesCents: $(20_000) }),
      traditionalCents: $(1_000_000),
      unrealisedLongTermCents: $(300_000),
    });
    const m = findMoves(p).find((x) => x.kind === "gains");
    expect(m).toBeDefined();
    expect(m!.effectCents).toBeGreaterThan(0);
  });

  it("times a planned bonus into a lower year", () => {
    const p = plan({
      traditionalCents: 0,
      retireYear: 2030,
      events: [{ id: "e1", kind: "bonus", year: 2028, amountCents: $(40_000) }],
    });
    const m = findMoves(p).find((x) => x.kind === "timing");
    expect(m).toBeDefined();
    expect(m!.fromYear).toBe(2028);
    expect(m!.year).toBeGreaterThan(2028);
    expect(project(p, m!.adjust).find((r) => r.year === m!.year)!.incomeCents).toBeGreaterThan(
      project(p).find((r) => r.year === m!.year)!.incomeCents,
    );
  });

  it("says nothing when no move is worth it", () => {
    const p = plan({ traditionalCents: 0, retireYear: 2060 });
    expect(findMoves(p)).toEqual([]);
  });
});
