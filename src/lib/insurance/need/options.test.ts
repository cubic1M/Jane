import { describe, expect, it } from "vitest";
import { OPTION_PICK_CAP } from "@/config/insurance";
import { demoPartner } from "@/lib/insurance/demo-partner";
import {
  computeNeeds,
  deductibleNeedsFor,
  liabilityNeedsFor,
  lifeNeedFor,
  umbrellaNeedFor,
  disabilityNeedFor,
  type NeedInput,
  type NeedPolicy,
} from "./index";
import { buildOptions, optionRequests, type OptionRequest, type PricedRequest } from "./options";

// Options to pick from (spec step 275): three or four variants priced by the stand-in, its
// pick marked with a confidence that never claims more than sample prices allow.

const car: NeedPolicy = {
  id: "p1",
  kind: "auto",
  status: "active",
  deductibleCents: 100_000,
  coverage: {
    bodilyInjuryPerPerson: 5_000_000,
    bodilyInjuryPerAccident: 10_000_000,
    propertyDamage: 5_000_000,
  },
};
const input = (over: Partial<NeedInput> = {}): NeedInput => ({
  yearlyPayCents: 9_600_000,
  dependants: 2,
  mortgageCents: 30_000_000,
  otherDebtCents: 1_500_000,
  mortgageYearsLeft: 22,
  savingsCents: 3_000_000,
  cashCents: 1_000_000,
  netWorthCents: 180_000_000,
  workLifeCoverCents: 0,
  policies: [car],
  ...over,
});

const now = new Date("2026-10-18T15:00:00Z");
async function price(requests: OptionRequest[]): Promise<PricedRequest[]> {
  return Promise.all(
    requests.map(async (request) => ({
      request,
      quotes: await demoPartner.quote(
        {
          kind: request.kind,
          state: null,
          household: { housing: "own", vehicles: 1, dependants: 2, pets: 0 },
          deductibleCents: request.deductibleCents,
          coverage: request.coverage,
          premiumFrequency: "monthly",
          startDate: "2026-10-19",
        },
        { now },
      ),
    })),
  );
}

async function setFor(
  need: ReturnType<typeof computeNeeds>[number],
  policy: NeedPolicy | null,
  current: number | null = 170_400,
  netWorthCents = 180_000_000,
) {
  const requests = optionRequests(need, policy, { yearlyPayCents: 9_600_000, netWorthCents });
  return {
    requests,
    set: buildOptions(need, await price(requests), current, { policyId: policy?.id ?? null }),
  };
}

describe("options", () => {
  it("offers like for like, the cover I'd size and a better one for car liability, its pick first", async () => {
    const [need] = liabilityNeedsFor(input({ netWorthCents: 20_000_000 }));
    const { requests, set } = await setFor(need, car, 170_400, 20_000_000);
    expect(requests.map((r) => r.role)).toEqual(["like_for_like", "meets_need", "better"]);
    expect(set.options.length).toBeGreaterThanOrEqual(3);
    expect(set.options.length).toBeLessThanOrEqual(4);
    expect(set.options[0].isPick).toBe(true);
    expect(set.options[0].role).toBe("meets_need");
    expect(set.options.filter((o) => o.isPick)).toHaveLength(1);
    expect(set.pickId).toBe(set.options[0].id);
    for (const o of set.options) {
      expect(o.annualPremiumCents).toBeGreaterThan(0);
      expect(o.whyThisOne.length).toBeGreaterThan(10);
      expect(o.coverLines.length).toBeGreaterThan(0);
      expect(o.details.length).toBeGreaterThan(0);
    }
  });

  it("says in one line what each gives or costs", async () => {
    const [need] = liabilityNeedsFor(input({ netWorthCents: 20_000_000 }));
    const { set } = await setFor(need, car, 170_400, 20_000_000);
    const like = set.options.find((o) => o.role === "like_for_like")!;
    expect(like.whyThisOne).toMatch(/^Cheapest that keeps your cover as it is: \$[\d,.]+ a year/);
    const pick = set.options[0];
    expect(pick.whyThisOne).toMatch(
      /^Meets the cover I'd size for you \(\$100,000\.00 and \$300,000\.00 of injury liability\)/,
    );
  });

  it("never claims more than sample prices allow, and says so", async () => {
    const [need] = liabilityNeedsFor(input());
    const requests = optionRequests(need, car);
    const set = buildOptions(need, await price(requests), 170_400, {
      evidence: { percent: 97, reason: "the limits on your policy" },
    });
    expect(set.confidence?.percent).toBe(OPTION_PICK_CAP);
    expect(set.confidence?.reason).toMatch(/sample prices from the stand-in, not real offers/);
  });

  it("gives the same pick for the same evidence", async () => {
    const [need] = liabilityNeedsFor(input());
    const a = await setFor(need, car);
    const b = await setFor(need, car);
    expect(a.set).toEqual(b.set);
  });

  it("offers deductible steps around the one that fits their cash", async () => {
    const [need] = deductibleNeedsFor(input({ cashCents: 600_000 }));
    const { requests, set } = await setFor(need, car);
    const deductibles = requests.map((r) => r.deductibleCents);
    expect(new Set(deductibles).size).toBe(deductibles.length);
    expect(deductibles).toContain(need.needCents);
    expect(set.options.length).toBeGreaterThanOrEqual(2);
  });

  it("offers an umbrella at the need, a million less and a million more", async () => {
    const need = umbrellaNeedFor(
      input({
        policies: [car, { ...car, id: "h", kind: "home", coverage: { liability: 30_000_000 } }],
      }),
    );
    const { requests } = await setFor(need, null, null);
    const amounts = requests.map((r) => r.coverage.liability);
    expect(requests.map((r) => r.role)).toContain("meets_need");
    expect(new Set(amounts).size).toBe(amounts.length);
  });

  it("offers life cover at the need, a quarter less, and a longer term", async () => {
    const need = lifeNeedFor(input({ mortgageYearsLeft: 5 }));
    const { requests, set } = await setFor(need, null, null);
    expect(requests.map((r) => r.role)).toEqual(["meets_need", "cheaper", "better"]);
    const benefits = requests.map((r) => Number(r.coverage.deathBenefit));
    expect(benefits[1]).toBeLessThan(benefits[0]);
    expect(requests[2].coverage.termYears).toBeGreaterThan(Number(requests[0].coverage.termYears));
    expect(set.options.find((o) => o.isPick)?.role).toBe("meets_need");
  });

  it("offers disability at half, 60% and 70% of pay", async () => {
    const need = disabilityNeedFor(input());
    const { requests } = await setFor(need, null, null);
    expect(
      requests.map((r) => Math.round((Number(r.coverage.monthlyBenefit) / 9_600_000) * 12 * 100)),
    ).toEqual([60, 50, 70]);
  });

  it("drops an option no eligible carrier quotes, and returns no pick when none do", () => {
    const [need] = liabilityNeedsFor(input());
    const set = buildOptions(need, [{ request: optionRequests(need, car)[0], quotes: [] }], null);
    expect(set.options).toEqual([]);
    expect(set.pickId).toBeNull();
    expect(set.confidence).toBeNull();
  });
});
