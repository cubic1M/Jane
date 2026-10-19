import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { CLAIM_GUIDES } from "@/config/claims";
import {
  COVERAGE_FIELDS,
  HEALTH_DEFAULT_SPEND_CENTS,
  POLICY_KINDS,
  QUOTABLE_KINDS,
  UMBRELLA_ASSETS_CENTS,
  type PolicyKind,
} from "@/config/insurance";
import { parseCoverage, valueWords } from "./coverage";
import { basePremium, demoPartner } from "./demo-partner";
import { coverageGaps } from "./gaps";
import {
  expectedOutOfPocket,
  expectedSpend,
  expectedYearlyCost,
  openEnrollmentDates,
} from "./health";
import { resolveHousehold, type AccountSigns } from "./household";
import { pickQuote } from "./pick";
import type { Policy } from "./policies";
import type { StoredQuote } from "./quotes";

// Every kind of cover (spec step 149): health, disability, umbrella, pet, travel and device
// protection in the profile, the quote engine and the gap rules. Pure.

const NOW = new Date("2026-10-19T12:00:00Z");
const NO_SIGNS: AccountSigns = { mortgage: false, homeOwned: false, rentPaid: false, cars: 0 };
const household = (signs: Partial<AccountSigns> = {}, saved: { pets?: number } = {}) =>
  resolveHousehold(
    {
      housing: null,
      vehicles: null,
      dependants: null,
      pets: saved.pets ?? null,
      dismissedGaps: [],
    },
    { ...NO_SIGNS, ...signs },
  );
const policy = (kind: PolicyKind, over: Partial<Policy> = {}): Policy => ({
  id: kind,
  kind,
  carrier: "Carrier",
  status: "active",
  source: "typed",
  premiumCents: 40_000,
  premiumFrequency: "monthly",
  deductibleCents: null,
  coverage: {},
  covers: null,
  renewalDate: null,
  termMonths: 12,
  documentId: null,
  merchantKey: null,
  ...over,
});
const keys = (h = household(), policies: Policy[] = []) =>
  coverageGaps(h, policies).map((g) => g.key);

describe("every kind of cover in the profile", () => {
  it.each(["disability", "umbrella", "travel", "device"] as PolicyKind[])(
    "has %s with its cover fields, a claim guide and quotes",
    (kind) => {
      expect(POLICY_KINDS[kind]).toBeTruthy();
      expect(COVERAGE_FIELDS[kind].length).toBeGreaterThan(0);
      expect(CLAIM_GUIDES[kind].steps.at(-1)?.key).toBe("paid");
      expect(QUOTABLE_KINDS).toContain(kind);
    },
  );

  it("reads days for a disability policy's wait", () => {
    expect(
      parseCoverage("disability", {
        monthlyBenefit: "3,000",
        waitingDays: "90",
        benefitYears: "5",
      }),
    ).toEqual({
      monthlyBenefit: 300_000,
      waitingDays: 90,
      benefitYears: 5,
    });
    expect(() => parseCoverage("disability", { waitingDays: "1000" })).toThrow("in days");
    expect(valueWords(COVERAGE_FIELDS.disability[1], 90)).toBe("90 days");
  });
});

describe("gap rules for every kind", () => {
  it("health: no plan on file, once there's bank data", () => {
    expect(keys(household({ medicalCents: 0 }))).toContain("health");
    expect(keys(household())).not.toContain("health");
    expect(keys(household({ medicalCents: 0 }), [policy("health")])).not.toContain("health");
  });

  it("disability: a paycheck and nothing to replace it", () => {
    expect(keys(household({ paycheck: true }))).toContain("disability");
    expect(keys(household({ paycheck: false }))).not.toContain("disability");
    expect(keys(household({ paycheck: true }), [policy("disability")])).not.toContain("disability");
  });

  it("umbrella: enough to protect, with its value in the reason", () => {
    const [gap] = coverageGaps(household({ assetsCents: 60_000_000 }), []);
    expect(gap).toMatchObject({ key: "umbrella" });
    expect(gap.why).toContain("$600,000.00");
    expect(keys(household({ assetsCents: UMBRELLA_ASSETS_CENTS - 1 }))).not.toContain("umbrella");
    expect(keys(household({ assetsCents: 60_000_000 }), [policy("umbrella")])).toEqual([]);
  });

  it("pet: pets and no pet insurance", () => {
    expect(keys(household({}, { pets: 2 }))).toEqual(["pet"]);
    expect(keys(household({}, { pets: 0 }))).toEqual([]);
    expect(keys(household({}, { pets: 1 }), [policy("pet")])).toEqual([]);
  });

  it("travel: a big trip booked lately", () => {
    expect(keys(household({ travelCents: 150_000 }))).toEqual(["travel"]);
    expect(keys(household({ travelCents: 50_000 }))).toEqual([]);
    expect(keys(household({ travelCents: 150_000 }), [policy("travel")])).toEqual([]);
  });

  it("device protection is never a gap", () => {
    expect(
      keys(household({ paycheck: true, assetsCents: 0, travelCents: 0, medicalCents: 0 }), [
        policy("health"),
        policy("disability"),
      ]),
    ).toEqual([]);
  });
});

describe("pricing the new kinds", () => {
  const at = {
    state: null,
    household: { housing: null, vehicles: null, dependants: null, pets: null },
  };
  it("prices disability by benefit and wait, umbrella by limit, travel by trip, device per device", () => {
    expect(
      basePremium("disability", { monthlyBenefit: 300_000, waitingDays: 90 }, 0, at),
    ).toBeCloseTo(72_000);
    expect(
      basePremium("disability", { monthlyBenefit: 300_000, waitingDays: 30 }, 0, at),
    ).toBeCloseTo(93_600);
    expect(basePremium("umbrella", { liability: 200_000_000 }, 0, at)).toBeCloseTo(60_000);
    expect(basePremium("travel", { tripCost: 500_000 }, 0, at)).toBeCloseTo(30_000);
    expect(basePremium("device", {}, 0, at)).toBe(12_000);
  });

  it("quotes marketplace health plans for the household, with no deductible on the others", async () => {
    const request = {
      kind: "health" as const,
      state: null,
      household: { housing: null, vehicles: null, dependants: 1, pets: null },
      deductibleCents: null,
      coverage: {},
      premiumFrequency: "monthly" as const,
      startDate: "2026-11-01",
    };
    const plans = await demoPartner.quote(request, { now: NOW });
    expect(plans.map((p) => p.plan)).toEqual([
      "Bluepeak Bronze (demo)",
      "Bluepeak Silver (demo)",
      "Lighthouse Silver (demo)",
      "Lighthouse Gold (demo)",
    ]);
    // One dependant: 1.8 times one person's premium.
    expect(plans[0].premiumCents).toBe(57_600);
    expect(plans[0]).toMatchObject({
      deductibleCents: 700_000,
      coverage: { coinsurance: 40, outOfPocketMax: 920_000 },
    });
    const [umbrella] = await demoPartner.quote(
      { ...request, kind: "umbrella", household: { ...request.household } },
      { now: NOW },
    );
    expect(umbrella.deductibleCents).toBeNull();
  });
});

describe("health plans by total yearly cost", () => {
  const plan = (deductibleCents: number, coinsurance: number, outOfPocketMax: number) => ({
    deductibleCents,
    coverage: { coinsurance, outOfPocketMax },
  });

  it("works out what the person would pay for their usual care", () => {
    expect(expectedOutOfPocket(plan(250_000, 20, 700_000), 150_000)).toBe(150_000);
    expect(expectedOutOfPocket(plan(250_000, 20, 700_000), 500_000)).toBe(300_000);
    expect(expectedOutOfPocket(plan(250_000, 20, 300_000), 5_000_000)).toBe(300_000);
    expect(expectedOutOfPocket({ deductibleCents: null, coverage: {} }, 1_000)).toBeNull();
    expect(expectedYearlyCost(plan(100_000, 20, 500_000), 600_000, 200_000)).toBe(720_000);
    expect(expectedSpend(household({ medicalCents: 80_000 }))).toBe(80_000);
    expect(expectedSpend(household())).toBe(HEALTH_DEFAULT_SPEND_CENTS);
  });

  it("picks on total cost, not the premium alone", () => {
    const quote = (name: string, premium: number, total: number): StoredQuote => ({
      id: name,
      policyId: "h",
      partner: "demo",
      partnerQuoteId: name,
      carrier: { id: name, name, rating: "A+", ratingScore: 95, claimsPhone: "", claimsUrl: "" },
      kind: "health",
      premiumCents: Math.round(premium / 12),
      premiumFrequency: "monthly",
      annualPremiumCents: premium,
      termMonths: 12,
      deductibleCents: 100_000,
      coverage: { outOfPocketMax: 500_000, coinsurance: 20 },
      sameCover: false,
      differences: [],
      demo: true,
      expiresAt: NOW,
      createdAt: NOW,
      plan: `${name} plan`,
      expectedCostCents: total,
    });
    // The cheapest premium isn't the cheapest year with this person's care.
    const result = pickQuote(
      { carrier: "Old", kind: "health" },
      700_000,
      [quote("Cheap", 400_000, 1_100_000), quote("Rich", 600_000, 700_000)],
      950_000,
    );
    expect(result?.pick.carrier.name).toBe("Rich");
    expect(result?.savingCents).toBe(250_000);
    expect(result?.why[0]).toBe(
      "Rich plan would cost about $7,000.00 a year with your usual care: $6,000.00 in premiums and about $1,000.00 out of pocket.",
    );
    expect(
      pickQuote(
        { carrier: "Old", kind: "health" },
        700_000,
        [quote("Rich", 600_000, 700_000)],
        null,
      ),
    ).toBeNull();
  });

  it("knows when open enrollment opens and closes", () => {
    expect(openEnrollmentDates("2026-10-19")).toEqual([
      { date: "2026-11-01", what: "start", year: 2027 },
      { date: "2027-01-15", what: "end", year: 2027 },
    ]);
    expect(openEnrollmentDates("2026-12-01")).toEqual([
      { date: "2027-01-15", what: "end", year: 2027 },
    ]);
    expect(openEnrollmentDates("2027-01-10")).toEqual([
      { date: "2027-01-15", what: "end", year: 2027 },
    ]);
    expect(openEnrollmentDates("2027-02-01")[0]).toEqual({
      date: "2027-11-01",
      what: "start",
      year: 2028,
    });
  });
});
