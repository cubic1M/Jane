import { describe, expect, it } from "vitest";
import { DEMO_PRICING } from "@/config/insurance";

// The stand-in prices more injury liability higher, at every step (insurance QA pass): a
// "more cover" option that costs the same as the pick is not a real choice.
describe("the stand-in's injury liability pricing", () => {
  it("never charges less for more cover", () => {
    const levels = [...DEMO_PRICING.auto.liabilityLevels].sort(
      (a, b) => a.atLeastCents - b.atLeastCents,
    );
    for (let i = 1; i < levels.length; i += 1) {
      expect(levels[i].factor).toBeGreaterThan(levels[i - 1].factor);
    }
  });
  it("has a step for the higher liability level the need calculators size", () => {
    expect(DEMO_PRICING.auto.liabilityLevels.some((l) => l.atLeastCents >= 25_000_000)).toBe(true);
  });
});
