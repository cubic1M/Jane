import { describe, expect, it } from "vitest";
import { buildProfile, type ProfileInput } from "./build";
import { inputFor } from "./sample";
import { missingFacts } from "./questions";

// T8b: a person priced as single beside children, because Jane cannot see the facts that decide head
// of household (IRS Pub. 501), is asked how they file among the first questions, as the residency
// question is asked early (T10).
const candidates = (told: ProfileInput["told"]) => {
  const base = inputFor("renter");
  const data: ProfileInput = { ...base, told: { ...base.told, ...told } };
  return missingFacts(buildProfile(data), data);
};

describe("the filing question for a person the one guess prices as single", () => {
  it("is asked when children are counted and there is no sign of a partner", () => {
    const filing = candidates({ has_children: true, monthly_income: 400_000 }).find(
      (c) => c.spec.fact === "filing_status",
    );
    expect(filing?.unlockCents).toBeGreaterThan(0);
  });
  it("is not asked for a person with no children, a partner, or an answer", () => {
    const has = (told: ProfileInput["told"]) =>
      candidates({ monthly_income: 400_000, ...told }).some((c) => c.spec.fact === "filing_status");
    expect(has({ has_children: false })).toBe(false);
    expect(has({ has_children: true, has_partner: true })).toBe(false);
    expect(has({ has_children: true, filing_status: "single" })).toBe(false);
  });
});
