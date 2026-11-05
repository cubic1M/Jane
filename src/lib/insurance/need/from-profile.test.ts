import { describe, expect, it } from "vitest";
import { buildProfile } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { disabilityNeedFor } from "./calculators";
import { needInputFromProfile } from "./from-profile";

describe("the net worth the umbrella is sized from", () => {
  it("counts what they own (a home) by its value", () => {
    const data = inputFor("renter");
    const without = needInputFromProfile(buildProfile(data), data)!;
    const withHome = {
      ...data,
      extras: { householdMembers: 0, ...data.extras, ownedValueCents: 40_000_000 },
    };
    const input = needInputFromProfile(buildProfile(withHome), withHome)!;
    expect(input.netWorthCents! - without.netWorthCents!).toBe(40_000_000);
  });
});

// Debugger 11-04: a retiree on Social Security and a pension was "$1.7k/mo short" on disability cover.
// It replaces pay from work, and neither of those stops if they fall ill.
describe("disability cover", () => {
  const needFor = (pattern: "salary" | "uneven" | "business" | "pension" | "unknown") => {
    const data = inputFor("renter");
    const profile = buildProfile(data);
    profile.facts.income_pattern = { ...profile.facts.income_pattern, value: pattern };
    return disabilityNeedFor(needInputFromProfile(profile, data)!);
  };

  it.each(["pension", "unknown"] as const)("isn't sized for income that reads as %s", (pattern) => {
    expect(needFor(pattern).applies).toBe(false);
  });

  it.each(["salary", "uneven", "business"] as const)("is sized for %s pay", (pattern) => {
    expect(needFor(pattern).applies).toBe(true);
  });
});
