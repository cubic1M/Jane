import { describe, expect, it } from "vitest";
import { buildProfile } from "@/profile/build";
import { inputFor } from "@/profile/sample";
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
