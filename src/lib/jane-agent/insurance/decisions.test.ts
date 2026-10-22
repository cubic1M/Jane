import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { computeNeeds } from "@/lib/insurance/need";
import { normalize } from "../intents";
import {
  DECISION_PATTERNS,
  decide,
  decisionKindOf,
  sentenceCount,
  type DecisionKind,
} from "./decisions";
import { parseInsurance } from "./intents";
import type { InsuranceSnapshot } from "./snapshot";

// Insurance decisions in the chat: a direct answer of three sentences or fewer from the
// person's own numbers; the verdict only in demo advice mode.

const household = (over: Record<string, unknown> = {}) =>
  ({
    housing: { value: "own", from: "accounts" },
    vehicles: { value: 1, from: "you" },
    dependants: { value: null, from: null },
    pets: { value: null, from: null },
    dismissedGaps: [],
    signals: { paycheck: true, assetsCents: 52_938_067, travelCents: 0, medicalCents: 5_000 },
    ...over,
  }) as never;

const car = {
  id: "p1",
  kind: "auto",
  carrier: "GEICO",
  status: "active",
  premiumCents: 14_200,
  premiumFrequency: "monthly",
  deductibleCents: 100_000,
  coverage: {
    bodilyInjuryPerPerson: 5_000_000,
    bodilyInjuryPerAccident: 10_000_000,
    collision: true,
  },
  nextRenewal: "Nov 27, 2026",
};

const rich = (advice: boolean): InsuranceSnapshot =>
  ({
    policies: [car],
    gaps: [],
    household: household(),
    advice,
    shops: [
      {
        id: "s1",
        policyId: "p1",
        status: "open",
        savingCents: 40_800,
        pick: { carrier: { name: "Lighthouse" }, annualPremiumCents: 129_600 },
      },
    ],
    savings: [
      { kind: "pay_in_full", yearlySavingCents: 13_320, detail: { payNowCents: 157_080 } },
      {
        kind: "higher_deductible",
        yearlySavingCents: 17_040,
        detail: { toDeductibleCents: 200_000 },
      },
      { kind: "bundle", yearlySavingCents: 9_000, detail: { withCarrier: "Lemonade" } },
    ],
    negotiations: [
      { id: "n1", status: "asked", currentAnnualCents: 170_400, renewalAnnualCents: 190_000 },
    ],
    benefits: [
      { kind: "health", status: "found", perPayCents: 14_500, payFrequency: "semimonthly" },
    ],
    healthYear: {
      plan: {
        label: "Acme PPO",
        deductibleCents: 50_000,
        outOfPocketMaxCents: 300_000,
        coinsurance: 20,
      },
      progress: {
        deductibleMetCents: 4_680,
        deductibleLeftCents: 45_320,
        oopSoFarCents: 4_680,
        maxMonth: null,
      },
      fsa: { electionCents: 240_000, leftCents: 217_320, daysLeft: 74 },
    },
  }) as never;

const bare = (advice: boolean) =>
  ({
    policies: [],
    gaps: [],
    household: household({ housing: { value: null, from: null } }),
    advice,
  }) as never;

const KINDS = [...new Set(DECISION_PATTERNS.map(([k]) => k))] as DecisionKind[];

describe("insurance decisions", () => {
  it.each([
    ["should I get umbrella insurance", "umbrella"],
    ["should I switch car insurance", "switch"],
    ["is my car insurance too expensive", "too_expensive"],
    ["should I raise the deductible on my car insurance", "deductible"],
    ["do I have enough car insurance", "enough_car"],
    ["do I need renters insurance", "renters"],
    ["should I pay my car insurance yearly", "pay_yearly"],
    ["what happens if I get in an accident", "accident"],
    ["do I need disability insurance", "disability"],
    ["do I need pet insurance", "pet"],
    ["should I bundle my car and home insurance", "bundle"],
    ["am I covered if I drive for Uber", "rideshare"],
    ["should I cancel my phone insurance", "phone"],
    ["should I keep my employer's health plan", "employer_health"],
    ["do I lose my FSA money at the end of the year", "fsa_left"],
    ["have I hit my deductible", "deductible_met"],
    ["what's my out of pocket max", "oop_max"],
    ["why is my insurance going up", "why_up"],
    ["should I add my teenager to my policy", "teen"],
    ["do I need business insurance for my side hustle", "business"],
    ["do I have enough life insurance", "life_enough"],
    ["is my life cover enough", "life_enough"],
    ["how much would it cost to switch car insurance", "switch_cost"],
  ] as const)("reads %s", (text, kind) => {
    const intent = parseInsurance(normalize(text));
    expect(intent).toMatchObject({ ask: "decide", decision: kind });
  });

  it("leaves a claim question to the claim calculator", () => {
    expect(
      parseInsurance(normalize("should I file a claim for a $1,200 repair on my car"))?.ask,
    ).toBe("claim_worth");
    expect(parseInsurance(normalize("what if the repair is $3,000"))?.ask).toBe("claim_worth");
  });

  it("doesn't take other lanes' words", () => {
    expect(decisionKindOf("bundle my subscriptions")).toBeNull();
    expect(decisionKindOf("what's the weather")).toBeNull();
  });

  it.each(KINDS)("answers %s in three sentences or fewer, with a person and without", (kind) => {
    for (const advice of [true, false]) {
      for (const snapshot of [rich(advice), bare(advice)]) {
        const r = decide(kind, snapshot, "2026-10-18");
        expect(sentenceCount(r.body), `${kind} advice=${advice}: ${r.body}`).toBeLessThanOrEqual(3);
        expect(r.body.length).toBeLessThanOrEqual(420);
      }
    }
  });

  it("gives the verdict and the label only in demo advice mode", () => {
    const on = decide("switch", rich(true), "2026-10-18");
    expect(on.refs).toMatchObject({ advice: true });
    expect(on.body).toMatch(/^Yes, it looks worth it\./);
    const off = decide("switch", rich(false), "2026-10-18");
    expect(off.refs).not.toHaveProperty("advice");
    expect(off.body).not.toMatch(/looks worth it/);
    expect(off.body).toMatch(/\$408\.00/);
  });

  it("says no to umbrella cover under the asset line", () => {
    const snap = rich(true) as unknown as { household: { signals: { assetsCents: number } } };
    snap.household.signals.assetsCents = 4_000_000;
    const r = decide("umbrella", snap as never, "x");
    expect(r.body).toMatch(/^Probably not yet\./);
    expect(r.body).toContain("$40,000.00");
  });

  it("uses the person's own figures", () => {
    expect(decide("too_expensive", rich(true), "x").body).toContain("$1,704.00");
    expect(decide("employer_health", rich(true), "x").body).toContain("$3,480.00");
    expect(decide("fsa_left", rich(true), "x").body).toContain("$2,173.20");
    expect(decide("deductible", rich(true), "x").body).toContain("$170.40");
    expect(decide("umbrella", rich(true), "x").body).toContain("$529,380.67");
  });
});

describe("how much cover do I need, from the same numbers as the detectors (spec step 278)", () => {
  const needs = computeNeeds({
    yearlyPayCents: 9_600_000,
    dependants: 2,
    mortgageCents: 30_000_000,
    otherDebtCents: 1_500_000,
    mortgageYearsLeft: 5,
    savingsCents: 3_000_000,
    cashCents: 1_000_000,
    netWorthCents: 180_000_000,
    workLifeCoverCents: 0,
    policies: [],
  });
  const withNeeds = (advice: boolean) => ({ ...rich(advice), needs }) as never;

  it("says the life cover needed, with the working in a sentence", () => {
    const r = decide("life_how_much", withNeeds(true), "x");
    expect(r.body).toMatch(/^About \$1,400,000\.00\./);
    expect(r.body).toContain("less your savings");
    expect(sentenceCount(r.body)).toBeLessThanOrEqual(3);
  });

  it("says the disability benefit and the umbrella size from the calculators", () => {
    expect(decide("disability_how_much", withNeeds(true), "x").body).toContain("$4,800.00 a month");
    expect(decide("umbrella_how_much", withNeeds(true), "x").body).toMatch(
      /umbrella of \$2,000,000\.00/,
    );
  });

  it("gives the facts, not the verdict, when advice is off", () => {
    const r = decide("life_how_much", withNeeds(false), "x");
    expect(r.refs).not.toHaveProperty("advice");
    expect(r.body).not.toMatch(/^About/);
  });

  it("asks for what it needs when the numbers aren't there", () => {
    expect(decide("life_how_much", rich(true), "x").body).toMatch(/who depends on your income/);
  });
});

describe("chat answers agree with the page's numbers (insurance QA pass)", () => {
  const base = {
    yearlyPayCents: 9_600_000,
    dependants: 0,
    mortgageCents: 0,
    otherDebtCents: 0,
    mortgageYearsLeft: null,
    savingsCents: 1_000_000,
    cashCents: 1_000_000,
    workLifeCoverCents: 0,
  };
  const auto = {
    id: "a1",
    kind: "auto" as const,
    status: "active",
    deductibleCents: 100_000,
    coverage: { bodilyInjuryPerPerson: 5_000_000, bodilyInjuryPerAccident: 10_000_000 },
  };
  const snap = (netWorthCents: number) =>
    ({
      ...rich(true),
      needs: computeNeeds({ ...base, netWorthCents, policies: [auto] }),
    }) as never;

  it("reads what cover and is my deductible right as decisions", () => {
    expect(decisionKindOf("what cover do i need")).toBe("what_cover");
    expect(decisionKindOf("is my deductible right")).toBe("deductible_fit");
    expect(decisionKindOf("what insurance do i need")).toBeNull();
  });

  it("lists the open gaps in three sentences or fewer, and links the first", () => {
    const r = decide("what_cover", snap(1_000_000), "x");
    expect(r.body).toMatch(/gaps?\./);
    expect(sentenceCount(r.body)).toBeLessThanOrEqual(5);
    expect(r.actions.some((a) => a.kind === "link")).toBe(true);
  });

  it("says whether the deductible fits the cash, from the same need as the page", () => {
    const r = decide("deductible_fit", snap(1_000_000), "x");
    expect(r.body).toMatch(/deductible/);
    expect(r.body).toMatch(/\$[\d,]+\.00/);
  });

  it("does not call the gross total a reason for an umbrella the page doesn't show", () => {
    // $529k by balances and values, but net worth after debts is under the line: no umbrella need.
    const r = decide("umbrella", snap(10_000_000), "x");
    expect(r.body).toMatch(/^Probably not yet\./);
    expect(r.body).toContain("after what you owe");
  });

  it("gives the disability amount from the need when asked if they need it", () => {
    const r = decide("disability", snap(1_000_000), "x");
    expect(r.body).toContain("$4,800.00 a month");
  });

  it("gives real accounts the gaps as facts, with no verdict or pick", () => {
    const real = {
      ...rich(false),
      needs: computeNeeds({ ...base, netWorthCents: 1_000_000, policies: [auto] }),
    } as never;
    for (const kind of ["what_cover", "deductible_fit", "disability"] as const) {
      const r = decide(kind, real, "x");
      expect(r.refs).not.toHaveProperty("advice");
      expect(r.body).not.toMatch(/^(Probably yes|You could go higher|Yes, it fits|\d+ gaps?)/);
    }
  });
});
