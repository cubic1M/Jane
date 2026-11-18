import { describe, expect, it } from "vitest";
import { liabilityNeedsFor, type NeedInput, type NeedPolicy } from "./index";

// Debug 2, fourth desktop sweep (11-17, Plaid sandbox, 14 months of checking + card): after the
// person confirmed "GEICO, $112.40 a month" found in their payments, Insurance said "Car injury
// liability, $300k short. You need $300k; you have $0." No limit was on file, which isn't $0: the
// tree's "Add its limit" is for exactly this, but only business liability ever said so.

const policy = (over: Partial<NeedPolicy>): NeedPolicy => ({
  id: "p1",
  kind: "auto",
  status: "active",
  deductibleCents: null,
  coverage: {},
  ...over,
});

const input = (policies: NeedPolicy[]): NeedInput => ({
  yearlyPayCents: 2_400_000,
  dependants: 0,
  mortgageCents: 0,
  otherDebtCents: 185_040,
  mortgageYearsLeft: null,
  savingsCents: 0,
  cashCents: 141_222,
  netWorthCents: -43_818,
  workLifeCoverCents: 0,
  policies,
});

describe("liability with no limit on file", () => {
  it("is a limit to add on a car policy, not $0 of cover", () => {
    const [car] = liabilityNeedsFor(input([policy({})]));
    expect(car.limitUnknown).toBe(true);
    expect(car.summary).not.toMatch(/\$0\.00/);
  });

  it("is the same for renters and home policies", () => {
    const needs = liabilityNeedsFor(
      input([policy({ id: "r", kind: "renters" }), policy({ id: "h", kind: "home" })]),
    );
    expect(needs.map((n) => n.limitUnknown)).toEqual([true, true]);
  });

  it("isn't said once the limits are on file, even when they're low", () => {
    const [car] = liabilityNeedsFor(
      input([
        policy({
          coverage: { bodilyInjuryPerPerson: 1_500_000, bodilyInjuryPerAccident: 3_000_000 },
        }),
      ]),
    );
    expect(car.limitUnknown).toBeUndefined();
    expect(car.gapCents).toBeGreaterThan(0);
  });
});
