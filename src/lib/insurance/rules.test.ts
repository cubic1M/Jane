import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
import {
  CoverageError,
  coverageLines,
  isLiabilityOnly,
  parseCoverage,
  readCoverage,
} from "./coverage";
import { coverageGaps } from "./gaps";
import { checkHousehold, resolveHousehold, type AccountSigns } from "./household";
import {
  EMPTY_POLICY_INPUT,
  PolicyError,
  checkPolicy,
  nextRenewal,
  policyFormValues,
  yearlyPremium,
  type Policy,
} from "./policies";

// The insurance profile's rules (spec step 102): cover limits, policies, household facts
// and coverage gaps. All pure.

const policy = (over: Partial<Policy> = {}): Policy => ({
  id: "p1",
  kind: "auto",
  carrier: "GEICO",
  status: "active",
  source: "typed",
  premiumCents: 14_200,
  premiumFrequency: "monthly",
  deductibleCents: 100_000,
  coverage: {},
  covers: null,
  renewalDate: "2026-11-28",
  termMonths: 12,
  documentId: null,
  merchantKey: null,
  ...over,
});

const NO_SIGNS: AccountSigns = { mortgage: false, homeOwned: false, rentPaid: false, cars: 0 };
type Saved = {
  housing: string | null;
  vehicles: number | null;
  dependants: number | null;
  pets: number | null;
  dismissedGaps: string[];
};
const nothingSaid: Saved = {
  housing: null,
  vehicles: null,
  dependants: null,
  pets: null,
  dismissedGaps: [],
};

describe("cover limits", () => {
  it("reads the form by kind, in cents, yes/no, years and percent", () => {
    expect(
      parseCoverage("auto", {
        bodilyInjuryPerPerson: "50,000",
        collision: "yes",
        comprehensive: "no",
        propertyDamage: "",
      }),
    ).toEqual({ bodilyInjuryPerPerson: 5_000_000, collision: true, comprehensive: false });
    expect(parseCoverage("life", { deathBenefit: "500000", termYears: "20" })).toEqual({
      deathBenefit: 50_000_000,
      termYears: 20,
    });
    expect(parseCoverage("pet", { reimbursement: "80%" })).toEqual({ reimbursement: 80 });
  });

  it("explains a bad value by its label", () => {
    expect(() => parseCoverage("auto", { collision: "maybe" })).toThrow(CoverageError);
    expect(() => parseCoverage("life", { termYears: "2.5" })).toThrow("whole years");
    expect(() => parseCoverage("pet", { reimbursement: "120" })).toThrow("percent");
    expect(() => parseCoverage("home", { dwelling: "lots" })).toThrow("The home itself");
  });

  it("keeps only the stored fields this kind has, with the right types", () => {
    expect(
      readCoverage("renters", { personalProperty: 3_000_000, collision: true, liability: "x" }),
    ).toEqual({ personalProperty: 3_000_000 });
    expect(readCoverage("auto", null)).toEqual({});
  });

  it("says each known limit in plain words", () => {
    expect(coverageLines("auto", { bodilyInjuryPerPerson: 5_000_000, collision: true })).toEqual([
      "Injury liability, per person: $50,000.00",
      "Collision (damage to your car in a crash): Yes",
    ]);
  });

  it("calls car cover liability only when both collision and comprehensive are said to be no", () => {
    expect(isLiabilityOnly("auto", { collision: false, comprehensive: false })).toBe(true);
    expect(isLiabilityOnly("auto", { collision: false })).toBe(false);
    expect(isLiabilityOnly("home", { collision: false, comprehensive: false })).toBe(false);
  });
});

describe("policies", () => {
  const input = { ...EMPTY_POLICY_INPUT, kind: "auto", carrier: "  GEICO  " };

  it("needs only the kind and the insurer", () => {
    expect(checkPolicy(input)).toMatchObject({
      kind: "auto",
      carrier: "GEICO",
      premiumCents: null,
      deductibleCents: null,
      renewalDate: null,
      termMonths: 12,
      coverage: {},
    });
  });

  it("checks every field", () => {
    expect(() => checkPolicy({ ...input, kind: "spaceship" })).toThrow(PolicyError);
    expect(() => checkPolicy({ ...input, carrier: "" })).toThrow("insurance company");
    expect(() => checkPolicy({ ...input, premium: "142" })).toThrow("how often");
    expect(() => checkPolicy({ ...input, premium: "lots", premiumFrequency: "monthly" })).toThrow(
      "price",
    );
    expect(() => checkPolicy({ ...input, renewalDate: "2027-02-30" })).toThrow("renewal date");
    expect(() => checkPolicy({ ...input, termMonths: "9" })).toThrow("term");
    expect(() => checkPolicy({ ...input, covers: "x".repeat(200) })).toThrow("covers");
    expect(() => checkPolicy({ ...input, coverage: { collision: "maybe" } })).toThrow(PolicyError);
  });

  it("works out the price a year", () => {
    expect(yearlyPremium(policy())).toBe(170_400);
    expect(yearlyPremium(policy({ premiumFrequency: "semiannual", premiumCents: 61_200 }))).toBe(
      122_400,
    );
    expect(yearlyPremium(policy({ premiumFrequency: null }))).toBeNull();
  });

  it("rolls a past renewal date forward a term at a time", () => {
    expect(nextRenewal(policy(), "2026-10-19")).toBe("2026-11-28");
    expect(nextRenewal(policy(), "2026-11-28")).toBe("2026-11-28");
    expect(nextRenewal(policy({ renewalDate: "2025-03-01" }), "2026-10-19")).toBe("2027-03-01");
    expect(nextRenewal(policy({ renewalDate: "2026-01-31", termMonths: 6 }), "2026-10-19")).toBe(
      "2027-01-31",
    );
    expect(nextRenewal(policy({ renewalDate: null }), "2026-10-19")).toBeNull();
  });

  it("fills the edit form from a record", () => {
    expect(
      policyFormValues(policy({ coverage: { collision: true, propertyDamage: 5_000_000 } })),
    ).toMatchObject({
      premium: "142.00",
      premiumFrequency: "monthly",
      deductible: "1000.00",
      coverage: { collision: "yes", propertyDamage: "50000", comprehensive: "" },
    });
  });
});

describe("household facts", () => {
  it("takes what the person said over the accounts", () => {
    const household = resolveHousehold(
      { ...nothingSaid, housing: "rent", vehicles: 0 },
      { mortgage: true, homeOwned: false, rentPaid: false, cars: 1 },
    );
    expect(household.housing).toEqual({ value: "rent", from: "you" });
    expect(household.vehicles).toEqual({ value: 0, from: "you" });
  });

  it("reads housing and cars from the accounts until the person says", () => {
    expect(resolveHousehold(null, { ...NO_SIGNS, mortgage: true, cars: 2 })).toMatchObject({
      housing: { value: "own", from: "accounts" },
      vehicles: { value: 2, from: "accounts" },
      dependants: { value: null, from: null },
    });
    expect(resolveHousehold(null, { ...NO_SIGNS, rentPaid: true }).housing).toEqual({
      value: "rent",
      from: "accounts",
    });
    expect(resolveHousehold(null, NO_SIGNS).housing).toEqual({ value: null, from: null });
  });

  it("checks the form; blank means not saying", () => {
    expect(checkHousehold({ housing: "", vehicles: "2", dependants: "", pets: "0" })).toEqual({
      housing: null,
      vehicles: 2,
      dependants: null,
      pets: 0,
    });
    expect(() =>
      checkHousehold({ housing: "boat", vehicles: "", dependants: "", pets: "" }),
    ).toThrow("where you live");
    expect(() =>
      checkHousehold({ housing: "", vehicles: "1.5", dependants: "", pets: "" }),
    ).toThrow("cars");
  });
});

describe("coverage gaps", () => {
  const household = (saved: Partial<Saved>, signs = NO_SIGNS) =>
    resolveHousehold({ ...nothingSaid, ...saved }, signs);

  it("finds renting with no renters cover, in plain words", () => {
    const [gap] = coverageGaps(household({}, { ...NO_SIGNS, rentPaid: true }), []);
    expect(gap).toMatchObject({
      key: "renters",
      kind: "renters",
      title: "No renters insurance on file",
    });
    expect(gap.why).toMatch(/^Your payments show rent/);
    expect(coverageGaps(household({ housing: "rent" }), [policy({ kind: "renters" })])).toEqual([]);
  });

  it("finds owning with no home cover, and a car with no car cover", () => {
    const gaps = coverageGaps(household({}, { ...NO_SIGNS, mortgage: true, cars: 1 }), []);
    expect(gaps.map((g) => g.key)).toEqual(["home", "auto"]);
    expect(gaps[0].why).toContain("escrow");
  });

  it("finds dependants with no life cover", () => {
    const [gap] = coverageGaps(household({ dependants: 2 }), []);
    expect(gap).toMatchObject({ key: "life" });
    expect(gap.why).toContain("2 people depend");
    expect(coverageGaps(household({ dependants: 0 }), [])).toEqual([]);
  });

  it("finds a car insured for liability only", () => {
    const only = policy({ coverage: { collision: false, comprehensive: false } });
    const [gap] = coverageGaps(household({ vehicles: 1 }), [only]);
    expect(gap).toMatchObject({ key: "liability_only", policyId: "p1", kind: "auto" });
    expect(gap.title).toBe("Your GEICO car policy only covers others");
  });

  it("doesn't count found, pending or cancelled policies as cover", () => {
    const gaps = coverageGaps(household({ housing: "rent" }), [
      policy({ kind: "renters", status: "found" }),
    ]);
    expect(gaps.map((g) => g.key)).toEqual(["renters"]);
  });

  it("never brings up a gap the person said they don't need", () => {
    expect(coverageGaps(household({ dependants: 1, dismissedGaps: ["life"] }), [])).toEqual([]);
  });

  it("says nothing when it knows nothing", () => {
    expect(coverageGaps(household({}), [])).toEqual([]);
  });
});
