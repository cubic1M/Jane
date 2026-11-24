import { describe, expect, it } from "vitest";
import { buildProfile } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { hsaMessage } from "@/lib/jane-agent/health-tax-message";
import { readHealthTaxes } from "./health-taxes-read";

// CodeRabbit sweep 1b: a married filer was given the family HSA limit as if their cover were
// known. The cover type isn't an input, so the family limit stays the assumption but the card
// says so and names the self-only limit.
describe("HSA limit when the cover type is not told", () => {
  it("marks a married filer's family limit as assumed and carries the self-only limit", () => {
    const d = inputFor("equity");
    const v = readHealthTaxes(buildProfile(d), d);
    if (v.hsa.family) {
      expect(v.hsa.coverageAssumed).toBe(true);
      expect(v.hsa.selfLimitCents).toBeLessThan(v.hsa.limitCents);
    } else {
      expect(v.hsa.coverageAssumed).toBe(false);
    }
  });

  it("the message tells a married filer the limit assumes family cover", () => {
    const d = inputFor("equity");
    const v = readHealthTaxes(buildProfile(d), d);
    const forced = {
      ...v,
      hsa: {
        ...v.hsa,
        family: true,
        coverageAssumed: true,
        selfLimitCents: 440_000,
        limitCents: 880_000,
        projectedExcessCents: 100_000,
        deposits: 3,
      },
    };
    const m = hsaMessage(forced as never);
    expect(m?.body).toMatch(/I don't know yours; with self-only cover the limit is \$4,400/);
  });
});
