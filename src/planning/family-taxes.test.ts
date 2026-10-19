import { describe, expect, it } from "vitest";
import { DEPENDENT_CARE_CREDIT, PAYROLL_TAX } from "@/config/tax-rates";
import { NO_INCOME, estimateTaxes, type EstimateInput } from "./tax-estimate";
import {
  aotcRules,
  careChoice,
  careRules,
  childCreditRules,
  childrenChoice,
  educationChoice,
  filingChoice,
  headOfHouseholdRules,
  llcRules,
  plan529Choice,
  type Child,
} from "./family-taxes";
import { careShare } from "./tax-savings";
import { residentTax } from "./tax-states";

// Spec step 169: each family choice shows both sides' tax; the eligibility rules are tested.

const input = (over: Partial<EstimateInput> = {}): EstimateInput => ({
  year: 2026,
  filingStatus: "married_joint",
  childrenUnder17: 2,
  otherDependants: 0,
  state: "NY",
  income: { ...NO_INCOME, wagesCents: 9_000_000, socialSecurityWagesCents: 9_000_000 },
  studentLoanInterestCents: 0,
  mortgageInterestCents: 0,
  charityCents: 0,
  medicalCents: 0,
  otherStateLocalTaxCents: 0,
  federalWithheldCents: 0,
  federalEstimatedPaidCents: 0,
  stateWithheldCents: 0,
  stateEstimatedPaidCents: 0,
  ...over,
});
const kid = (age: number, over: Partial<Child> = {}): Child => ({
  ageAtYearEnd: age,
  hasSsn: true,
  monthsLivedWithYou: 12,
  ...over,
});
const fed = (i: EstimateInput) => estimateTaxes(i).totalTaxCents;

describe("eligibility rules", () => {
  it("child tax credit: under 17, a Social Security number, more than half the year", () => {
    expect(childCreditRules(kid(16))).toEqual([]);
    expect(childCreditRules(kid(17))).toEqual([
      "They're 17 at the end of the year; the credit is for under 17.",
    ]);
    expect(childCreditRules(kid(5, { hasSsn: false }))).toEqual([
      "They need a Social Security number by the filing deadline.",
    ]);
    expect(childCreditRules(kid(5, { monthsLivedWithYou: 6 }))).toEqual([
      "They must live with you more than half the year.",
    ]);
    expect(childCreditRules(kid(5, { monthsLivedWithYou: 7 }))).toEqual([]);
  });

  it("dependent care: a child under 13, both working when married, not separately", () => {
    expect(careRules({ children: [kid(12)], status: "married_joint", bothWork: true })).toEqual([]);
    expect(careRules({ children: [kid(13)], status: "single", bothWork: true })).toEqual([
      "Care counts for a child under 13.",
    ]);
    expect(
      careRules({ children: [kid(4)], status: "married_joint", bothWork: false }),
    ).toHaveLength(1);
    expect(
      careRules({ children: [kid(4)], status: "married_separate", bothWork: true }),
    ).toHaveLength(1);
  });

  it("education: the AOTC for the first four years at half-time; neither when filing separately", () => {
    expect(aotcRules({ yearsOfCollegeBefore: 3, halfTime: true }, "single")).toEqual([]);
    expect(aotcRules({ yearsOfCollegeBefore: 4, halfTime: true }, "single")).toEqual([
      "It's only for the first four years of college.",
    ]);
    expect(aotcRules({ yearsOfCollegeBefore: 0, halfTime: false }, "single")).toEqual([
      "The student must be at least half-time.",
    ]);
    expect(aotcRules({ yearsOfCollegeBefore: 0, halfTime: true }, "married_separate")).toHaveLength(
      1,
    );
    expect(llcRules("single")).toEqual([]);
    expect(llcRules("married_separate")).toHaveLength(1);
  });

  it("head of household: unmarried, paying over half the home, with a qualifying person", () => {
    expect(
      headOfHouseholdRules({ married: false, paysOverHalfHome: true, qualifyingPerson: true }),
    ).toEqual([]);
    expect(
      headOfHouseholdRules({ married: true, paysOverHalfHome: false, qualifyingPerson: false }),
    ).toHaveLength(3);
  });
});

describe("each choice shows both sides' tax", () => {
  it("claiming the children or not", () => {
    const c = childrenChoice(input(), [kid(5), kid(17)])!;
    expect(c.sides[0].taxCents).toBe(fed(input({ childrenUnder17: 1, otherDependants: 1 })));
    expect(c.sides[1].taxCents).toBe(fed(input({ childrenUnder17: 0, otherDependants: 0 })));
    expect(c.better).toBe(0);
    expect(c.savesCents).toBe(c.sides[1].taxCents - c.sides[0].taxCents);
  });

  it("a dependent care FSA or the credit", () => {
    const base = input();
    const c = careChoice({
      estimate: base,
      careCents: 1_000_000,
      children: [kid(3), kid(6)],
      bothWork: true,
    })!;
    // FSA: $7,500 off wages, payroll tax saved, the credit on what's left of the $6,000 cap (none).
    const fsaInput = input({
      income: {
        ...NO_INCOME,
        wagesCents: 9_000_000 - 750_000,
        socialSecurityWagesCents: 9_000_000 - 750_000,
      },
    });
    expect(c.sides[0].taxCents).toBe(
      fed({ ...fsaInput, otherCreditsCents: 0 }) -
        Math.round(750_000 * (PAYROLL_TAX.socialSecurityRate + PAYROLL_TAX.medicareRate)),
    );
    const credit = Math.round(
      DEPENDENT_CARE_CREDIT.costLimit[1] * careShare(estimateTaxes(base).agiCents, true),
    );
    expect(c.sides[1].taxCents).toBe(fed({ ...base, otherCreditsCents: credit }));
    expect(c.better).toBe(c.sides[0].taxCents <= c.sides[1].taxCents ? 0 : 1);
    // Not open without a child under 13.
    const older = careChoice({
      estimate: base,
      careCents: 500_000,
      children: [kid(14)],
      bothWork: true,
    })!;
    expect(older.sides.map((s) => s.eligible)).toEqual([false, false]);
    expect(older.better).toBeNull();
  });

  it("the American Opportunity or Lifetime Learning credit", () => {
    const base = input({
      filingStatus: "single",
      childrenUnder17: 0,
      income: { ...NO_INCOME, wagesCents: 6_000_000, socialSecurityWagesCents: 6_000_000 },
    });
    const c = educationChoice({
      estimate: base,
      tuitionCents: 500_000,
      student: { yearsOfCollegeBefore: 1, halfTime: true },
    })!;
    // AOTC $2,500 (40% refundable) against LLC 20% of $5,000 = $1,000.
    expect(c.sides[0].label).toBe("American Opportunity Credit ($2,500)");
    expect(c.sides[0].taxCents).toBe(fed({ ...base, otherCreditsCents: 150_000 }) - 100_000);
    expect(c.sides[1].taxCents).toBe(fed({ ...base, otherCreditsCents: 100_000 }));
    expect(c.better).toBe(0);
    // Past four years, only the LLC is open.
    const later = educationChoice({
      estimate: base,
      tuitionCents: 500_000,
      student: { yearsOfCollegeBefore: 4, halfTime: true },
    })!;
    expect(later.sides[0].eligible).toBe(false);
    expect(later.better).toBe(1);
    expect(later.savesCents).toBe(0);
  });

  it("a 529's state break: state tax with and without the deduction", () => {
    const base = input();
    const c = plan529Choice({ estimate: base, state: "NY", contributionCents: 600_000 })!;
    const agi = estimateTaxes(base).agiCents;
    const ny = (income: number) => residentTax("NY", income, base)!.taxCents;
    // NY: up to $10,000 a year for joint filers.
    expect(c.sides[0].taxCents).toBe(fed(base) + ny(agi - 600_000));
    expect(c.sides[1].taxCents).toBe(fed(base) + ny(agi));
    expect(c.better).toBe(0);
    expect(plan529Choice({ estimate: base, state: "CA", contributionCents: 600_000 })).toBeNull();
  });

  it("married filing jointly or separately, and head of household or single", () => {
    const base = input({ childrenUnder17: 0 });
    const c = filingChoice({
      estimate: base,
      married: true,
      spouseWagesCents: 4_000_000,
      paysOverHalfHome: false,
    })!;
    expect(c.sides[0].taxCents).toBe(
      fed(
        input({
          childrenUnder17: 0,
          income: { ...NO_INCOME, wagesCents: 13_000_000, socialSecurityWagesCents: 13_000_000 },
        }),
      ),
    );
    expect(c.sides[0].taxCents).toBeLessThanOrEqual(c.sides[1].taxCents);

    const single = input({ filingStatus: "single", childrenUnder17: 1 });
    const hoh = filingChoice({
      estimate: single,
      married: false,
      spouseWagesCents: 0,
      paysOverHalfHome: true,
    })!;
    expect(hoh.sides[0].taxCents).toBe(fed({ ...single, filingStatus: "head_of_household" }));
    expect(hoh.sides[1].taxCents).toBe(fed({ ...single, filingStatus: "single" }));
    expect(hoh.better).toBe(0);
    const notHoh = filingChoice({
      estimate: single,
      married: false,
      spouseWagesCents: 0,
      paysOverHalfHome: false,
    })!;
    expect(notHoh.sides[0].eligible).toBe(false);
    expect(notHoh.better).toBe(1);
  });
});
