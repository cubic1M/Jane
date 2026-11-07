import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { buildProfile, type ProfileInput } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { runDetectors } from "./index";
import { SAVERS_CREDIT_DETECTORS } from "./savers-credit";

// Debugger 11-06: a single parent (children's payments, one employer's paychecks, no filing status
// given) was measured against the $80,500 joint limit and told "$2,000 each", so someone near
// $67,900 heard they may qualify. One earner with children is a head of household's $60,375.

const run = (told: ProfileInput["told"], topic = "savers_credit") => {
  const data: ProfileInput = {
    ...inputFor("renter"),
    today: "2026-11-06",
    told: { ...inputFor("renter").told, ...told },
  };
  return (
    runDetectors({ profile: buildProfile(data), data }, SAVERS_CREDIT_DETECTORS).find(
      (s) => s.topic === topic,
    ) ?? null
  );
};

describe("the Saver's Credit for a family before they say how they file", () => {
  it("measures one earner with children against the head of household limit", () => {
    // $4,350 a month take-home is about $67,860 gross: over $60,375, under $80,500.
    expect(run({ monthly_income: 435_000, household: "family", earners: 1 })).toBeNull();
    // $3,300 a month is about $51,480: under it, and only their own $2,000 counts.
    const s = run({ monthly_income: 330_000, household: "family", earners: 1 })!;
    expect(s.why).toContain("under the $60,375.00 limit");
    expect(s.why).not.toContain("each");
    expect(s.worthCents).toBe(20_000);
  });

  it("still files a family with two earners jointly", () => {
    const s = run({ monthly_income: 435_000, household: "family", earners: 2 })!;
    expect(s.why).toContain("under the $80,500.00 limit");
    expect(s.worthCents).toBe(40_000);
  });

  it("phases the 2027 Saver's Match out on the head of household line too", () => {
    // About $67,860: inside the joint phase-out ($41,000 to $71,000), past the head of household's.
    expect(
      run({ monthly_income: 435_000, household: "family", earners: 1 }, "savers_match"),
    ).toBeNull();
    // About $28,080: under the head of household's $30,750, so one person's full $1,000.
    const s = run({ monthly_income: 180_000, household: "family", earners: 1 }, "savers_match")!;
    expect(s.worthCents).toBe(100_000);
    expect(s.why).toContain("from $30,750.00 to $53,250.00");
    expect(s.why).not.toContain("each");
  });
});
