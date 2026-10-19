import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { RESHOP_MIN_SAVING_CENTS } from "@/config/insurance";
import { pickQuote, weighted } from "./pick";
import type { StoredQuote } from "./quotes";

// Jane's pick (spec step 104): the lowest price for the same cover, weighted by the
// carrier's rating, why in three lines, and the runners-up. Pure.

const policy = { carrier: "GEICO", kind: "auto" as const };
const quote = (
  name: string,
  annual: number,
  ratingScore: number,
  over: Partial<StoredQuote> = {},
) =>
  ({
    id: name,
    policyId: "p1",
    partner: "demo",
    partnerQuoteId: `q-${name}`,
    carrier: {
      id: name,
      name,
      rating: ratingScore >= 98 ? "A++" : ratingScore >= 95 ? "A+" : ratingScore >= 90 ? "A" : "A-",
      ratingScore,
      claimsPhone: "1-800-555-0100",
      claimsUrl: "https://example.com",
    },
    kind: "auto",
    premiumCents: Math.round(annual / 12),
    premiumFrequency: "monthly",
    annualPremiumCents: annual,
    termMonths: 12,
    deductibleCents: 100_000,
    coverage: {},
    sameCover: true,
    differences: [],
    demo: true,
    expiresAt: new Date("2026-11-18T00:00:00Z"),
    createdAt: new Date("2026-10-19T00:00:00Z"),
    ...over,
  }) satisfies StoredQuote;

describe("Jane's pick", () => {
  it("picks the lowest price for the same cover, and says why in three lines", () => {
    const result = pickQuote(policy, 170_400, [
      quote("Bluepeak", 142_800, 98),
      quote("Lighthouse", 129_600, 95),
      quote("Northstar", 110_400, 85, { sameCover: false, differences: ["Less cover"] }),
    ]);
    expect(result?.pick.carrier.name).toBe("Lighthouse");
    expect(result?.runnersUp.map((q) => q.carrier.name)).toEqual(["Bluepeak"]);
    expect(result?.savingCents).toBe(40_800);
    expect(result?.why).toEqual([
      "Same cover and deductible as your GEICO car insurance.",
      "$1,296.00 a year, $408.00 less than you pay now.",
      "Rated A+ for paying claims, and the lowest price of the 2 quotes with the same cover.",
    ]);
  });

  it("weighs the rating: a much better-rated carrier wins at a slightly higher price", () => {
    const result = pickQuote(policy, 170_400, [
      quote("Cheap", 120_000, 85),
      quote("Strong", 125_000, 98),
    ]);
    expect(weighted(quote("Cheap", 120_000, 85))).toBeCloseTo(129_000);
    expect(result?.pick.carrier.name).toBe("Strong");
    expect(result?.why[2]).toBe(
      "Rated A++ for paying claims, better than the one quote that cost a little less.",
    );
  });

  it("never picks a carrier rated too low, less cover, or too small a saving", () => {
    expect(pickQuote(policy, 170_400, [quote("Weak", 100_000, 80)])).toBeNull();
    expect(
      pickQuote(policy, 170_400, [quote("Less", 100_000, 95, { sameCover: false })]),
    ).toBeNull();
    expect(
      pickQuote(policy, 170_400, [quote("Close", 170_400 - RESHOP_MIN_SAVING_CENTS + 1, 95)]),
    ).toBeNull();
    expect(pickQuote(policy, null, [quote("Any", 100_000, 95)])).toBeNull();
  });
});
