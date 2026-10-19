import { describe, expect, it } from "vitest";
import { HSA_CASH_CUSHION_CENTS, HSA_LIMITS, HSA_MIN_INVEST_CENTS } from "@/config/hsa";
import { CONTRIBUTION_LIMITS } from "@/config/tax-rates";
import { hsaLimit, hsaPlan } from "./hsa";

// Spec step 159: limits come from config with sources.

describe("the HSA limit", () => {
  it("is the year's self or family limit, with the catch-up from 55", () => {
    expect(HSA_LIMITS.selfCents).toBe(CONTRIBUTION_LIMITS.hsaSelf);
    expect(HSA_LIMITS.source).toMatch(/IRS Rev\. Proc\. 2025-19/);
    expect(hsaLimit("self", 40)).toBe(440_000);
    expect(hsaLimit("family", 40)).toBe(875_000);
    expect(hsaLimit("self", 55)).toBe(440_000 + 100_000);
    expect(hsaLimit("self", null)).toBe(440_000);
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
    });
    expect(plan).toEqual({
      investedCents: 142_180,
      cashCents: 285_000,
      cushionCents: HSA_CASH_CUSHION_CENTS,
      toInvestCents: 285_000 - HSA_CASH_CUSHION_CENTS,
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
    });
    expect(small.toInvestCents).toBe(0);
    expect(small.roomCents).toBe(0);
  });
});
