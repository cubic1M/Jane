import { describe, expect, it } from "vitest";
import { GAP_ADVICE, GAP_KEYS, type PolicyKind } from "@/config/insurance";
import { businessGaps, runsBusiness, type SelfEmployment } from "./business-rules";
import type { Policy } from "./policies";

// Business and side-gig cover (spec step 201): each kind of gap, and a personal policy is
// never counted as cover for business use.

const none: SelfEmployment = {
  declared: false,
  serviceCents: 0,
  gigCents: 0,
  miles: 0,
  equipmentCents: 0,
};
const policy = (kind: PolicyKind, coverage: Policy["coverage"] = {}): Policy =>
  ({
    id: `p-${kind}`,
    kind,
    carrier: "Acme",
    status: "active",
    coverage,
  }) as unknown as Policy;
const keys = (s: SelfEmployment, policies: Policy[] = []) =>
  businessGaps(s, policies).map((g) => g.key);

describe("who runs a business", () => {
  it("is anyone who said so or earned enough on the side", () => {
    expect(runsBusiness(none)).toBe(false);
    expect(runsBusiness({ ...none, declared: true })).toBe(true);
    expect(runsBusiness({ ...none, serviceCents: 60_000 })).toBe(true);
    expect(runsBusiness({ ...none, gigCents: 10_000 })).toBe(false);
  });

  it("has no business gaps for a salaried person", () => {
    expect(businessGaps(none, [policy("auto"), policy("home")])).toEqual([]);
    expect(businessGaps(undefined, [])).toEqual([]);
  });
});

describe("general and professional liability", () => {
  const freelancer = { ...none, serviceCents: 800_000 };

  it("asks for both when a freelancer has no business policy", () => {
    expect(keys(freelancer)).toEqual(["business_liability", "professional_liability"]);
  });

  it("asks a shop with card sales for liability, not professional cover", () => {
    // The small-business owner (gap audit): sales through Square, not contractor income.
    const shop = { ...none, salesCents: 2_000_000 };
    expect(runsBusiness(shop)).toBe(true);
    expect(keys(shop)).toEqual(["business_liability"]);
    expect(businessGaps(shop, [])[0].why).toMatch(/^Your card sales are business income/);
    expect(keys(shop, [policy("business", { generalLiability: 100_000_000 })])).toEqual([]);
  });

  it("never counts a home, renters, car or umbrella policy as business cover", () => {
    const personal = (["home", "renters", "auto", "umbrella"] as PolicyKind[]).map((k) =>
      policy(k, { liability: 500_000_000, generalLiability: 500_000_000 }),
    );
    expect(keys(freelancer, personal)).toEqual(["business_liability", "professional_liability"]);
  });

  it("closes with a business policy that has enough of each", () => {
    const business = policy("business", {
      generalLiability: 100_000_000,
      professionalLiability: 100_000_000,
    });
    expect(keys(freelancer, [business])).toEqual([]);
  });

  it("says when a business policy's liability is too low", () => {
    const low = policy("business", { generalLiability: 30_000_000, professionalLiability: 1 });
    const gaps = businessGaps(freelancer, [low]);
    expect(gaps.map((g) => g.key)).toEqual(["business_liability"]);
    expect(gaps[0].title).toMatch(/liability cover is low/);
  });
});

describe("business use on the car", () => {
  it("asks for gig drivers and for business miles, with a car policy", () => {
    expect(keys({ ...none, declared: true, gigCents: 100_000 }, [policy("auto")])).toContain(
      "car_business_use",
    );
    expect(keys({ ...none, declared: true, miles: 2_000 }, [policy("auto")])).toContain(
      "car_business_use",
    );
  });

  it("asks nothing without a car policy, few miles, or a rideshare policy already", () => {
    expect(keys({ ...none, declared: true, miles: 2_000 })).not.toContain("car_business_use");
    expect(keys({ ...none, declared: true, miles: 200 }, [policy("auto")])).not.toContain(
      "car_business_use",
    );
    expect(
      keys({ ...none, declared: true, gigCents: 100_000 }, [policy("auto"), policy("rideshare")]),
    ).not.toContain("car_business_use");
  });

  it("says a personal policy doesn't cover work driving", () => {
    const gap = businessGaps({ ...none, declared: true, miles: 3_000 }, [policy("auto")]).find(
      (g) => g.key === "car_business_use",
    );
    expect(gap?.kind).toBe("auto");
    expect(gap?.why).toMatch(/not work driving/);
  });
});

describe("equipment", () => {
  const s = { ...none, declared: true, equipmentCents: 134_900 };
  it("asks when equipment was bought and no business property cover exists", () => {
    expect(keys(s)).toContain("business_equipment");
    expect(keys(s, [policy("home", { businessProperty: 5_000_000 })])).toContain(
      "business_equipment",
    );
  });
  it("closes with business property cover", () => {
    expect(keys(s, [policy("business", { businessProperty: 500_000 })])).not.toContain(
      "business_equipment",
    );
  });
});

describe("every business gap says what to add", () => {
  it.each([
    "business_liability",
    "professional_liability",
    "car_business_use",
    "business_equipment",
  ] as const)("%s", (key) => {
    expect(GAP_KEYS).toContain(key);
    expect(GAP_ADVICE[key].text.length).toBeGreaterThan(20);
  });
});
