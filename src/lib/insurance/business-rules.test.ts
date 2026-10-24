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
  salesCents: 0,
  miles: 0,
  equipmentCents: 0,
  gasMonthlyCents: 0,
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

  // Real-user QA: a salaried person who sold something once on Shopify ($640) was asked about
  // business insurance. A business is paid again and again.
  it("isn't one payout from selling something", () => {
    expect(runsBusiness({ ...none, salesCents: 64_000, payments: 1 })).toBe(false);
    expect(runsBusiness({ ...none, salesCents: 64_000, payments: 3 })).toBe(true);
    // Saying so on the tax profile is enough.
    expect(runsBusiness({ ...none, declared: true, payments: 0 })).toBe(true);
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

// A shop (Jo): card sales are business income; she needs general liability, not professional,
// and driving to suppliers shows in her gas.
describe("a shop", () => {
  const jo = { ...none, salesCents: 30_000_000 };
  it("needs general liability for customers, not professional liability", () => {
    expect(runsBusiness(jo)).toBe(true);
    expect(keys(jo)).toEqual(["business_liability"]);
    const [gap] = businessGaps(jo, []);
    expect(gap.why).toMatch(/card sales are business income/);
  });
  it("asks for business use on the car when the gas shows driving for the business", () => {
    const driving = { ...jo, gasMonthlyCents: 5_500 };
    expect(keys(driving, [policy("auto")])).toContain("car_business_use");
    const car = businessGaps(driving, [policy("auto")]).find((g) => g.key === "car_business_use")!;
    expect(car.why).toMatch(/\$55\.00 a month on gas/);
    expect(car.cents).toEqual([5_500]);
    // A little gas, or gas with no business, isn't driving for work.
    expect(keys({ ...jo, gasMonthlyCents: 1_000 }, [policy("auto")])).not.toContain(
      "car_business_use",
    );
    expect(keys({ ...none, gasMonthlyCents: 9_000 }, [policy("auto")])).toEqual([]);
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
