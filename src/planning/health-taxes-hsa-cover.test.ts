import { describe, expect, it } from "vitest";
import { buildProfile } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { hsaMessage } from "@/lib/jane-agent/health-tax-message";
import { readHealthTaxes } from "./health-taxes-read";

// CodeRabbit sweep 1b: a married filer was given the family HSA limit as if their cover were
// known. The cover type isn't an input, so the family limit stays the assumption but the card
// says so and names the self-only limit.
describe("HSA limit when the cover type is not told", () => {
  // T8b: how they file is what they said, else a sign of a partner, else single (filingStatusOf); the
  // household fact says how many people, not how they file.
  const read = (filing: "single" | "married_joint") => {
    const d = inputFor("equity");
    const profile = buildProfile(d);
    const facts = {
      ...profile.facts,
      filing_status: { ...profile.facts.filing_status, value: filing, source: "told" as const },
    };
    return readHealthTaxes({ ...profile, facts }, d).hsa;
  };

  it("marks a married filer's family limit as assumed and carries the self-only limit", () => {
    const v = read("married_joint");
    expect(v.family).toBe(true);
    expect(v.coverageAssumed).toBe(true);
    expect(v.selfLimitCents).toBeLessThan(v.limitCents);
  });

  // T8b (CodeRabbit): a parent priced as single is not read as self-only cover.
  it("keeps the family limit for a household of a family that files single", () => {
    const d = inputFor("equity");
    const profile = buildProfile(d);
    const facts = {
      ...profile.facts,
      household: { ...profile.facts.household, value: "family" },
      filing_status: { ...profile.facts.filing_status, value: "single", source: "told" as const },
    };
    expect(readHealthTaxes({ ...profile, facts }, d).hsa.family).toBe(true);
  });

  it("assumes nothing for a single filer", () => {
    const v = read("single");
    expect(v.family).toBe(false);
    expect(v.coverageAssumed).toBe(false);
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
        contributedCents: 600_000,
        projectedCents: 600_000,
      },
    };
    const m = hsaMessage(forced as never);
    expect(m?.body).toMatch(/\$1,600\.00 over its \$4,400\.00 limit already/);
    // Contributions already over the family limit and a higher projection: current and projected
    // stay apart.
    const high = hsaMessage({
      ...forced,
      hsa: {
        ...forced.hsa,
        contributedCents: 900_000,
        projectedCents: 1_800_000,
        excessCents: 20_000,
      },
    } as never);
    expect(high?.body).toMatch(/\$4,600\.00 over its \$4,400\.00 limit already/);
    expect(high?.body).not.toMatch(/\$13,600/);
    expect(m?.body).toMatch(/I don't know yours; with self-only cover the limit is \$4,400/);
  });
});
