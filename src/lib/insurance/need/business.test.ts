import { describe, expect, it } from "vitest";
import {
  BUSINESS_LIABILITY_TARGET_CENTS,
  BUSINESS_PROFESSIONAL_TARGET_CENTS,
} from "@/config/insurance";
import { demoPartner } from "@/lib/insurance/demo-partner";
import type { SelfEmployment } from "@/lib/insurance/business-rules";
import { businessNeedsFor, computeNeeds, type NeedInput, type NeedPolicy } from "./index";
import { buildOptions, optionRequests, type OptionRequest } from "./options";

// Business and side-gig cover in the need calculators (spec step 201): general liability for
// clients or customers, professional liability for client work, equipment cover, and only a
// business policy counts. The option card prices each at the level I'd size, half and double.

const work = (over: Partial<SelfEmployment> = {}): SelfEmployment => ({
  declared: false,
  serviceCents: 0,
  gigCents: 0,
  salesCents: 0,
  miles: 0,
  equipmentCents: 0,
  gasMonthlyCents: 0,
  ...over,
});
const input = (business: SelfEmployment | null, policies: NeedPolicy[] = []): NeedInput => ({
  yearlyPayCents: 9_600_000,
  dependants: 0,
  mortgageCents: 0,
  otherDebtCents: 0,
  mortgageYearsLeft: null,
  savingsCents: 1_000_000,
  cashCents: 1_000_000,
  netWorthCents: 2_000_000,
  workLifeCoverCents: 0,
  policies,
  business,
});
const kinds = (i: NeedInput) => businessNeedsFor(i).map((n) => n.kind);
const businessPolicy = (coverage: NeedPolicy["coverage"]): NeedPolicy => ({
  id: "biz",
  kind: "business",
  status: "active",
  deductibleCents: null,
  coverage,
});

describe("business needs", () => {
  it("gives a freelancer general and professional liability (Sam)", () => {
    const sam = input(work({ serviceCents: 7_200_000 }));
    expect(kinds(sam)).toEqual(["business_liability", "professional_liability"]);
    const [general, professional] = businessNeedsFor(sam);
    expect(general).toMatchObject({
      needCents: BUSINESS_LIABILITY_TARGET_CENTS,
      haveCents: 0,
      gapCents: BUSINESS_LIABILITY_TARGET_CENTS,
    });
    expect(professional.gapCents).toBe(BUSINESS_PROFESSIONAL_TARGET_CENTS);
    expect(professional.summary).toMatch(/cost them money/);
    // A sentence that says it's what Jane would look at, not cover already held (phone walk).
    expect(general.summary).toMatch(/^I'd look at \$1,000,000\.00 of general liability/);
    expect(professional.summary).toMatch(/^I'd look at /);
  });

  it("gives a shop general liability, not professional (Jo)", () => {
    const jo = input(work({ declared: true, salesCents: 30_000_000 }));
    expect(kinds(jo)).toEqual(["business_liability"]);
  });

  it("covers work equipment bought, and nothing for someone with no business", () => {
    expect(kinds(input(work({ serviceCents: 600_000, equipmentCents: 249_900 })))).toContain(
      "business_equipment",
    );
    expect(kinds(input(work()))).toEqual([]);
    expect(kinds(input(null))).toEqual([]);
    // A gig driver's risk is the car, not general liability.
    expect(kinds(input(work({ gigCents: 900_000 })))).toEqual([]);
  });

  it("counts only a business policy, and closes the gap when it has the cover", () => {
    const home: NeedPolicy = {
      id: "home",
      kind: "home",
      status: "active",
      deductibleCents: 100_000,
      coverage: { liability: 100_000_000 },
    };
    const sam = (policies: NeedPolicy[]) =>
      businessNeedsFor(input(work({ serviceCents: 7_200_000 }), policies));
    expect(sam([home])[0].haveCents).toBe(0);
    const covered = sam([
      businessPolicy({ generalLiability: 200_000_000, professionalLiability: 100_000_000 }),
    ]);
    expect(covered.map((n) => n.gapCents)).toEqual([0, 0]);
    expect(covered[0].policyId).toBe("biz");
  });

  it("is in the needs with the rest", () => {
    expect(computeNeeds(input(work({ serviceCents: 7_200_000 }))).map((n) => n.kind)).toEqual(
      expect.arrayContaining(["business_liability", "professional_liability"]),
    );
  });
});

describe("business options", () => {
  const now = new Date("2026-10-18T15:00:00Z");
  const price = (requests: OptionRequest[]) =>
    Promise.all(
      requests.map(async (request) => ({
        request,
        quotes: await demoPartner.quote(
          {
            kind: request.kind,
            state: null,
            household: { housing: "rent", vehicles: 1, dependants: 0, pets: 0 },
            deductibleCents: request.deductibleCents,
            coverage: request.coverage,
            premiumFrequency: "monthly",
            startDate: "2026-10-19",
          },
          { now },
        ),
      })),
    );

  it("prices the level I'd size, half and double, the bigger cover costing more", async () => {
    const [general, professional] = businessNeedsFor(input(work({ serviceCents: 7_200_000 })));
    for (const need of [general, professional]) {
      const requests = optionRequests(need, null);
      expect(requests.map((r) => r.role)).toEqual(["meets_need", "cheaper", "better"]);
      const set = buildOptions(need, await price(requests), null);
      expect(set.pickId).toBe("need");
      const cost = (id: string) => set.options.find((o) => o.id === id)!.annualPremiumCents;
      expect(cost("cheaper")).toBeLessThan(cost("need"));
      expect(cost("need")).toBeLessThan(cost("better"));
    }
    // Professional liability alone carries no general liability, and the card doesn't list it.
    const alone = buildOptions(professional, await price(optionRequests(professional, null)), null);
    expect(alone.options[0].coverLines.join(" ")).not.toMatch(/General liability/);
    expect(optionRequests(professional, null)[0].coverage).toEqual({
      generalLiability: 0,
      professionalLiability: BUSINESS_PROFESSIONAL_TARGET_CENTS,
    });
  });

  it("keeps the rest of their business policy when it changes one cover", () => {
    const policy = businessPolicy({ generalLiability: 50_000_000, businessProperty: 2_000_000 });
    const [general] = businessNeedsFor(
      input(work({ declared: true, salesCents: 30_000_000 }), [policy]),
    );
    const requests = optionRequests(general, policy);
    expect(requests[0]).toMatchObject({ role: "like_for_like", coverage: policy.coverage });
    expect(requests.find((r) => r.role === "meets_need")?.coverage).toEqual({
      generalLiability: BUSINESS_LIABILITY_TARGET_CENTS,
      businessProperty: 2_000_000,
    });
  });
});
