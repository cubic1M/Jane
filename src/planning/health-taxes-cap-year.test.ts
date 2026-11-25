import { describe, expect, it } from "vitest";
import { fplFor } from "@/config/health-taxes";
import { ptcCheck } from "./health-taxes";

// CodeRabbit sweep 1c, cfg-01 #1: the repayment-cap table only covers some years. A year before
// 2026 that it doesn't list has caps nobody has entered, so no repayment is said for it (the
// table's own 2025 numbers are FOR REVIEW: see src/config/health-taxes.ts).

const input = (year: number) => ({
  year,
  incomeCents: Math.round(fplFor(1) * 3.9),
  householdSize: 1,
  benchmarkYearCents: 200_000,
  advanceYearCents: 900_000,
});

describe("ptcCheck by tax year", () => {
  it("says nothing is repaid for a year before 2026 the cap table doesn't list", () => {
    const r = ptcCheck(input(2024));
    expect(r.repayKnown).toBe(false);
    expect(r.repayCents).toBe(0);
  });

  it("still works for a listed year and for the years with no cap", () => {
    expect(ptcCheck(input(2025))).toMatchObject({ repayKnown: true, capCents: 157_500 });
    const later = ptcCheck(input(2027));
    expect(later.repayKnown).toBe(true);
    expect(later.capCents).toBeNull();
    expect(later.repayCents).toBeGreaterThan(157_500);
  });
});
