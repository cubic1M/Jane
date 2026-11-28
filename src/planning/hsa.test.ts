import { describe, expect, it } from "vitest";
import { HSA_CASH_CUSHION_CENTS, HSA_MIN_INVEST_CENTS, hsaLimits } from "@/config/hsa";
import { NoTaxParamsError } from "@/config/tax-params";
import { hsaLimit, hsaPlan } from "./hsa";

// Spec step 159: limits come from config with sources.

describe("the HSA limit", () => {
  it("is the year's self or family limit, with the catch-up from 55", () => {
    expect(hsaLimits(2026).source).toMatch(/IRS Rev\. Proc\. 2025-19/);
    expect(hsaLimit("self", 40, 2026)).toBe(440_000);
    expect(hsaLimit("family", 40, 2026)).toBe(875_000);
    expect(hsaLimit("self", 55, 2026)).toBe(440_000 + 100_000);
    expect(hsaLimit("self", null, 2026)).toBe(440_000);
  });

  // Rev. Proc. 2026-24 section 3.01(1): $4,500 self-only and $9,000 family for 2027; Rev. Proc.
  // 2024-25: $4,300 and $8,550 for 2025. Each year reads its own.
  it("is each year's own, and a year without figures has none", () => {
    expect(hsaLimit("self", 40, 2027)).toBe(450_000);
    expect(hsaLimit("family", 40, 2027)).toBe(900_000);
    expect(hsaLimit("family", 55, 2027)).toBe(1_000_000);
    expect(hsaLimit("self", 40, 2025)).toBe(430_000);
    expect(hsaLimit("family", 40, 2025)).toBe(855_000);
    expect(() => hsaLimit("self", 40, 2028)).toThrow(NoTaxParamsError);
  });
});

describe("hsaPlan", () => {
  it("invests the cash beyond the cushion and spreads the room over the paychecks", () => {
    const plan = hsaPlan({
      balanceCents: 427_180,
      cashCents: 285_000,
      contributedCents: 240_000,
      coverage: "self",
      age: 45,
      year: 2026,
    });
    expect(plan).toEqual({
      investedCents: 142_180,
      cashCents: 285_000,
      cushionCents: HSA_CASH_CUSHION_CENTS,
      toInvestCents: 285_000 - HSA_CASH_CUSHION_CENTS,
      limitYear: 2026,
      limitSource: "IRS Rev. Proc. 2025-19 (2026 HSA limits)",
      limitCents: 440_000,
      roomCents: 200_000,
      perPaycheckCents: Math.ceil(200_000 / 24),
    });
  });

  it("leaves cash within the cushion alone, and has no room past the limit", () => {
    const small = hsaPlan({
      balanceCents: 0,
      cashCents: HSA_CASH_CUSHION_CENTS + HSA_MIN_INVEST_CENTS - 1,
      contributedCents: 500_000,
      coverage: "self",
      age: 30,
      year: 2026,
    });
    expect(small.toInvestCents).toBe(0);
    expect(small.roomCents).toBe(0);
  });
});
