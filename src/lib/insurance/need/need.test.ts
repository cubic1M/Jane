import { describe, expect, it } from "vitest";
import {
  DEDUCTIBLE_LADDERS,
  HIGHER_LIABILITY_NET_WORTH_CENTS,
  LIABILITY_LEVELS,
  UMBRELLA_ASSETS_CENTS,
  UMBRELLA_NEED,
} from "@/config/insurance";
import {
  computeNeeds,
  deductibleNeedsFor,
  disabilityNeedFor,
  lifeNeedFor,
  liabilityNeedsFor,
  umbrellaNeedFor,
  type NeedInput,
  type NeedPolicy,
} from "./index";

// What cover a person needs (spec step 274): each calculator at its edges, and the same inputs
// always give the same need.

const policy = (over: Partial<NeedPolicy> = {}): NeedPolicy => ({
  id: "p1",
  kind: "auto",
  status: "active",
  deductibleCents: 100_000,
  coverage: { bodilyInjuryPerPerson: 5_000_000, bodilyInjuryPerAccident: 10_000_000 },
  ...over,
});

const input = (over: Partial<NeedInput> = {}): NeedInput => ({
  yearlyPayCents: 9_600_000,
  dependants: 2,
  mortgageCents: 30_000_000,
  otherDebtCents: 1_500_000,
  mortgageYearsLeft: 22,
  savingsCents: 3_000_000,
  cashCents: 1_000_000,
  netWorthCents: 20_000_000,
  workLifeCoverCents: 0,
  policies: [policy()],
  ...over,
});

describe("term life", () => {
  it("sizes income, debts and schooling, less savings", () => {
    const n = lifeNeedFor(input());
    // 10 years of $96,000, the mortgage, other debts, final expenses and two children's schooling
    // ($15,000 + $10,000 each), less $30,000 of savings.
    expect(n.needCents).toBe(n.gapCents);
    // $960,000 + $300,000 + $15,000 + $15,000 + $100,000 − $30,000 = $1,360,000, up to $1,400,000.
    expect(n.gapCents).toBe(140_000_000);
    expect(n.lines.some((l) => l.label.includes("Less your savings"))).toBe(true);
    expect(n.termYears).toBe(25);
  });

  it("counts policies and cover through work against the need", () => {
    const base = lifeNeedFor(input());
    const covered = lifeNeedFor(
      input({
        workLifeCoverCents: 20_000_000,
        policies: [policy({ id: "l", kind: "life", coverage: { deathBenefit: 30_000_000 } })],
      }),
    );
    expect(covered.haveCents).toBe(50_000_000);
    expect(covered.gapCents).toBeLessThan(base.gapCents);
  });

  it("is not a need with no dependants or no pay", () => {
    expect(lifeNeedFor(input({ dependants: 0 })).applies).toBe(false);
    expect(lifeNeedFor(input({ yearlyPayCents: null })).applies).toBe(false);
  });
});

describe("disability", () => {
  it("is about 60% of pay a month, less what a policy pays", () => {
    expect(disabilityNeedFor(input()).needCents).toBe(480_000);
    const d = disabilityNeedFor(
      input({
        policies: [policy({ id: "d", kind: "disability", coverage: { monthlyBenefit: 300_000 } })],
      }),
    );
    expect(d.gapCents).toBe(180_000);
    expect(d.unit).toBe("per_month");
  });

  it("needs pay to be known", () => {
    expect(disabilityNeedFor(input({ yearlyPayCents: null })).applies).toBe(false);
  });
});

describe("umbrella", () => {
  it("doesn't apply under the net worth line", () => {
    expect(umbrellaNeedFor(input({ netWorthCents: UMBRELLA_ASSETS_CENTS - 1 })).applies).toBe(
      false,
    );
    expect(umbrellaNeedFor(input({ netWorthCents: null })).applies).toBe(false);
  });

  it("is net worth over the car and home limits, in steps of a million, up to a most", () => {
    const n = umbrellaNeedFor(
      input({
        netWorthCents: 180_000_000,
        policies: [
          policy({ coverage: { bodilyInjuryPerAccident: 30_000_000 } }),
          policy({ id: "h", kind: "home", coverage: { liability: 30_000_000 } }),
        ],
      }),
    );
    expect(n.needCents).toBe(2 * UMBRELLA_NEED.stepCents);
    expect(n.gapCents).toBe(n.needCents);
    expect(umbrellaNeedFor(input({ netWorthCents: 5_000_000_000 })).needCents).toBe(
      UMBRELLA_NEED.maxCents,
    );
    expect(
      umbrellaNeedFor(
        input({
          netWorthCents: 60_000_000,
          policies: [policy({ id: "u", kind: "umbrella", coverage: { liability: 100_000_000 } })],
        }),
      ).gapCents,
    ).toBe(0);
  });
});

describe("deductible", () => {
  it("is the largest step half the cash carries", () => {
    const ladder = DEDUCTIBLE_LADDERS.auto!;
    const [n] = deductibleNeedsFor(input({ cashCents: 600_000 }));
    expect(n.needCents).toBe(Math.max(...ladder.filter((s) => s <= 300_000)));
    expect(n.direction).toBe("raise");
    expect(n.policyId).toBe("p1");
  });

  it("says lower when the deductible is more than the cash carries, never below the ladder's first step", () => {
    const [n] = deductibleNeedsFor(
      input({ cashCents: 10_000, policies: [policy({ deductibleCents: 200_000 })] }),
    );
    expect(n.direction).toBe("lower");
    expect(n.needCents).toBe(Math.min(...DEDUCTIBLE_LADDERS.auto!));
  });

  it("is ok when it already fits, and skips kinds with no ladder", () => {
    const [ok] = deductibleNeedsFor(
      input({ cashCents: 400_000, policies: [policy({ deductibleCents: 200_000 })] }),
    );
    expect(ok.direction).toBe("ok");
    expect(
      deductibleNeedsFor(input({ policies: [policy({ kind: "life", deductibleCents: 1 })] })),
    ).toEqual([]);
  });
});

describe("liability levels", () => {
  it("measures the car's injury limits against the tier for their net worth", () => {
    const [base] = liabilityNeedsFor(input());
    expect(base.needCents).toBe(LIABILITY_LEVELS.base.autoPerAccidentCents);
    expect(base.gapCents).toBe(LIABILITY_LEVELS.base.autoPerAccidentCents - 10_000_000);
    const [higher] = liabilityNeedsFor(input({ netWorthCents: HIGHER_LIABILITY_NET_WORTH_CENTS }));
    expect(higher.needCents).toBe(LIABILITY_LEVELS.higher.autoPerAccidentCents);
  });

  it("covers home and renters liability, and is met when the limit is enough", () => {
    const needs = liabilityNeedsFor(
      input({
        policies: [
          policy({ id: "h", kind: "home", coverage: { liability: 30_000_000 } }),
          policy({ id: "r", kind: "renters", coverage: { liability: 5_000_000 } }),
        ],
      }),
    );
    const byKind = Object.fromEntries(needs.map((n) => [n.kind, n]));
    expect(byKind.home_liability.gapCents).toBe(0);
    expect(byKind.renters_liability.gapCents).toBe(LIABILITY_LEVELS.base.rentersCents - 5_000_000);
  });

  it("ignores a policy that isn't active", () => {
    expect(liabilityNeedsFor(input({ policies: [policy({ status: "cancelled" })] }))).toEqual([]);
  });
});

describe("computeNeeds", () => {
  it("lists only the needs that apply, always the same for the same inputs", () => {
    const a = computeNeeds(input());
    expect(a.map((n) => n.kind)).toEqual(["life", "disability", "auto_liability", "deductible"]);
    expect(computeNeeds(input())).toEqual(a);
    expect(computeNeeds(input({ dependants: 0, yearlyPayCents: null, policies: [] }))).toEqual([]);
  });

  it("never reports a negative gap", () => {
    for (const n of computeNeeds(input({ workLifeCoverCents: 900_000_000 }))) {
      expect(n.gapCents).toBeGreaterThanOrEqual(0);
    }
  });
});
