import { describe, expect, it, vi } from "vitest";
import { buildProfile, type ProfileInput } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { readHealthTaxes } from "./health-taxes-read";
import { readRetirementTaxes } from "./retirement-taxes-read";

// Tax T32b: the health and retirement sections price the calendar year with that year's own figures.
// From January 1, 2027 the 2027 figures are the law (Rev. Proc. 2026-35, 2026-24), not the 2026
// constants these readers used to take from src/config/tax-rates.ts for every year.
const flat = (rate: number) => [{ over: 0, rate }];
vi.mock("@/config/tax-params", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/tax-params")>();
  return {
    ...actual,
    federalParams: (year: number) => {
      const params = actual.federalParams(year);
      // A marker table for 2027 only: one 50 percent bracket and no standard deduction.
      if (year !== 2027 || !(globalThis as { __marker2027?: boolean }).__marker2027) return params;
      const statuses = [
        "single",
        "married_joint",
        "married_separate",
        "head_of_household",
      ] as const;
      const each = <T>(value: T) => Object.fromEntries(statuses.map((s) => [s, value]));
      return {
        ...params,
        brackets: { ...params.brackets, value: each(flat(0.5)) as never },
        standardDeduction: { ...params.standardDeduction, value: each(0) as never },
      };
    },
  };
});

// The same person a year later: every date moves forward one year.
const shiftYear = (input: ProfileInput, years: number): ProfileInput => {
  const shift = (d: string) => `${Number(d.slice(0, 4)) + years}${d.slice(4)}`;
  return {
    ...input,
    today: shift(input.today),
    transactions: input.transactions.map((t) => ({ ...t, date: shift(t.date) })),
  };
};
const $ = (dollars: number) => Math.round(dollars * 100);

describe("the health section reads the year's own figures", () => {
  const base = inputFor("preretire");

  it("2026: the 2026 standard deduction and HSA limit", () => {
    const r = readHealthTaxes(buildProfile(base), base);
    expect(r.year).toBe(2026);
    expect([$(16_100), $(18_150), $(32_200), $(35_500)]).toContain(r.medical.standardCents);
    expect([$(4_400), $(5_400)]).toContain(r.hsa.selfLimitCents);
  });

  it("2027: the 2027 standard deduction (Rev. Proc. 2026-35) and HSA limit (Rev. Proc. 2026-24)", () => {
    const data = shiftYear(base, 1);
    const r = readHealthTaxes(buildProfile(data), data);
    expect(r.year).toBe(2027);
    expect([$(16_600), $(18_700), $(33_200), $(36_600)]).toContain(r.medical.standardCents);
    expect([$(4_500), $(5_500)]).toContain(r.hsa.selfLimitCents);
    expect([$(9_000), $(10_000)]).toContain(r.hsa.limitCents);
  });

  it("2028: no figures, so no section at all (refused, never 2027's)", () => {
    const data = shiftYear(base, 2);
    expect(() => readHealthTaxes(buildProfile(data), data)).toThrow(
      expect.objectContaining({ name: "NoTaxParamsError", year: 2028 }),
    );
  });
});

describe("the retirement section reads the year's own brackets", () => {
  const base = inputFor("retiree");

  it("2027 takes its bracket from 2027's table, not 2026's", () => {
    const real = shiftYear(base, 1);
    const normal = readRetirementTaxes(buildProfile(real), real);
    expect(normal.year).toBe(2027);
    (globalThis as { __marker2027?: boolean }).__marker2027 = true;
    try {
      const marked = readRetirementTaxes(buildProfile(real), real);
      // The marker table has one 50 percent bracket: only a reader of 2027's table sees it.
      expect(marked.bracket).toBe(0.5);
      expect(normal.bracket).not.toBe(0.5);
      // 2026 is untouched by the marker.
      const y2026 = readRetirementTaxes(buildProfile(base), base);
      expect(y2026.year).toBe(2026);
      expect(y2026.bracket).not.toBe(0.5);
    } finally {
      delete (globalThis as { __marker2027?: boolean }).__marker2027;
    }
  });
});
