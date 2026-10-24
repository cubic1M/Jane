import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { checkGuardrails } from "@/lib/guardrails";
import { coverageCheckup, type CheckupInput } from "./checkup";
import { resolveHousehold } from "./household";
import type { Policy } from "./policies";

// The coverage checkup's rules (spec step 106): each recommendation shows the cost and the
// risk it changes. Pure.

const policy = (over: Partial<Policy> = {}): Policy => ({
  id: "car",
  kind: "auto",
  carrier: "GEICO",
  status: "active",
  source: "demo",
  premiumCents: 14_200,
  premiumFrequency: "monthly",
  deductibleCents: 100_000,
  coverage: {
    bodilyInjuryPerPerson: 10_000_000,
    bodilyInjuryPerAccident: 30_000_000,
    propertyDamage: 5_000_000,
    collision: true,
    comprehensive: true,
    uninsuredMotorist: true,
  },
  covers: null,
  renewalDate: "2026-11-28",
  termMonths: 12,
  documentId: null,
  merchantKey: null,
  ...over,
});

const input = (over: Partial<CheckupInput> = {}): CheckupInput => ({
  policies: [policy()],
  household: resolveHousehold(null, {
    mortgage: false,
    homeOwned: false,
    rentPaid: false,
    cars: 1,
  }),
  savingsCents: 100_000,
  carValuesCents: [],
  homeValueCents: null,
  newBaby: false,
  ...over,
});
const keys = (i: CheckupInput) => coverageCheckup(i).map((r) => r.key);

describe("the coverage checkup", () => {
  it("raises a deductible the savings cover three times over, with the saving and the risk", () => {
    const [rec] = coverageCheckup(input({ savingsCents: 1_200_000 }));
    expect(rec).toMatchObject({
      key: "deductible_up",
      policyId: "car",
      title: "Raise the deductible on your GEICO car insurance to $2,500.00.",
      costCents: -18_933,
      cost: "Saves about $189.33 a year",
      risk: "On a claim you'd pay up to $1,500.00 more yourself ($2,500.00 instead of $1,000.00). Your savings ($12,000.00) cover that more than 3 times over.",
    });
    expect(keys(input({ savingsCents: 700_000 }))).toEqual([]);
  });

  it("lowers a deductible the savings couldn't cover", () => {
    const [rec] = coverageCheckup(input({ savingsCents: 60_000 }));
    expect(rec).toMatchObject({
      key: "deductible_down",
      title: "Lower the deductible on your GEICO car insurance to $500.00.",
      costCents: 18_933,
      cost: "About $189.33 more a year",
    });
    expect(rec.risk).toMatch(/^A claim would cost you at most \$500\.00 instead of \$1,000\.00/);
  });

  it("raises low injury cover on a car, with its cost", () => {
    const low = policy({
      coverage: {
        ...policy().coverage,
        bodilyInjuryPerPerson: 2_500_000,
        bodilyInjuryPerAccident: 5_000_000,
      },
    });
    const [rec] = coverageCheckup(input({ policies: [low] }));
    expect(rec).toMatchObject({ key: "liability_up", cost: "About $473.33 more a year" });
    expect(rec.risk).toBe(
      "If you cause an accident, injuries above $25,000.00 a person are yours to pay today. This covers up to $100,000.00.",
    );
  });

  it("drops full cover on a car worth little", () => {
    const [rec] = coverageCheckup(input({ carValuesCents: [300_000] }));
    expect(rec).toMatchObject({
      key: "full_cover_old_car",
      title: "Drop collision and comprehensive from your GEICO car insurance.",
      cost: "Saves about $585.75 a year",
    });
    expect(rec.risk).toContain("worth about $3,000.00");
    expect(keys(input({ carValuesCents: [900_000] }))).toEqual([]);
  });

  it("finds home cover well under or over the home's value", () => {
    const home = policy({
      id: "home",
      kind: "home",
      carrier: "Allstate",
      premiumCents: 150_000,
      premiumFrequency: "yearly",
      coverage: { dwelling: 20_000_000, liability: 30_000_000 },
    });
    const under = coverageCheckup(input({ policies: [home], homeValueCents: 40_000_000 }));
    expect(under[0]).toMatchObject({ key: "home_under", cost: "About $1,500.00 more a year" });
    const over = coverageCheckup(
      input({
        policies: [{ ...home, coverage: { dwelling: 80_000_000 } }],
        homeValueCents: 40_000_000,
      }),
    );
    expect(over[0]).toMatchObject({ key: "home_over", cost: "Saves about $750.00 a year" });
  });

  it("suggests a bundle when car and home are with different carriers", () => {
    const renters = policy({
      id: "rent",
      kind: "renters",
      carrier: "Lemonade",
      premiumCents: 1_500,
      premiumFrequency: "monthly",
      deductibleCents: null,
      coverage: {},
    });
    const recs = coverageCheckup(input({ policies: [policy(), renters] }));
    expect(recs.find((r) => r.key === "bundle")).toMatchObject({
      policyId: null,
      cost: "Saves about $188.40 a year",
    });
    expect(
      keys(input({ policies: [policy(), { ...renters, carrier: "GEICO Insurance" }] })),
    ).not.toContain("bundle");
  });

  it("adds life cover after a new baby, unless there is some", () => {
    const [rec] = coverageCheckup(input({ newBaby: true }));
    expect(rec).toMatchObject({
      key: "life_after_baby",
      title: "Add 20-year term life insurance of $500,000.00.",
      cost: "About $175.00 more a year",
    });
    expect(
      keys(input({ newBaby: true, policies: [policy(), policy({ id: "l", kind: "life" })] })),
    ).not.toContain("life_after_baby");
  });

  it("says nothing about found or pending policies, or without savings", () => {
    expect(
      coverageCheckup(input({ policies: [policy({ status: "found" })], savingsCents: 1_200_000 })),
    ).toEqual([]);
    expect(coverageCheckup(input({ savingsCents: null }))).toEqual([]);
  });

  it("only uses figures it lists, so its words pass the demo advice guardrails", () => {
    const recs = coverageCheckup(
      input({ savingsCents: 1_200_000, carValuesCents: [300_000], newBaby: true }),
    );
    expect(recs.length).toBeGreaterThan(1);
    for (const r of recs) {
      const text = `${r.title} ${r.cost}. ${r.risk}`;
      expect(checkGuardrails(text, r.cents, undefined, "demo_advice"), text).toEqual({ ok: true });
    }
  });
});

describe("business and side-gig cover (spec step 201)", () => {
  const freelancer = () =>
    input({
      household: resolveHousehold(null, {
        mortgage: false,
        homeOwned: false,
        rentPaid: false,
        cars: 1,
        selfEmployment: {
          declared: true,
          serviceCents: 800_000,
          gigCents: 0,
          salesCents: 0,
          miles: 3_000,
          equipmentCents: 134_900,
          gasMonthlyCents: 0,
        },
      }),
    });

  it("recommends each missing business cover, with its cost and the risk", () => {
    const keys = coverageCheckup(freelancer()).map((r) => r.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        "business_liability",
        "professional_liability",
        "car_business_use",
        "business_equipment",
      ]),
    );
    for (const r of coverageCheckup(freelancer()).filter(
      (r) => r.key.includes("business") || r.key.includes("professional"),
    )) {
      expect(r.costCents).toBeGreaterThan(0);
      expect(r.risk.length).toBeGreaterThan(20);
      const text = `${r.title} ${r.cost}. ${r.risk}`;
      expect(checkGuardrails(text, r.cents, undefined, "demo_advice"), text).toEqual({ ok: true });
    }
  });

  it("says nothing for someone with a paycheck and no side work", () => {
    expect(coverageCheckup(input()).map((r) => r.key)).not.toContain("business_liability");
  });
});
