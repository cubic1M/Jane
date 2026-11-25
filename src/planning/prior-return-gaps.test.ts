import { describe, expect, it } from "vitest";
import { NO_INCOME, estimateTaxes, type EstimateInput } from "./tax-estimate";
import { reviewReturn } from "./prior-return";

// Last year's return review: the facts it can't see are held back, and credits are added up
// as one estimate, not finding by finding.

const input = (over: Partial<EstimateInput> = {}): EstimateInput => ({
  year: 2025,
  filingStatus: "single",
  childrenUnder17: 0,
  otherDependants: 0,
  state: "TX",
  income: { ...NO_INCOME, wagesCents: 5_000_000, socialSecurityWagesCents: 5_000_000 },
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
const kid = { ageAtYearEnd: 4, hasSsn: true, monthsLivedWithYou: 12 };
const review = (over: Partial<Parameters<typeof reviewReturn>[0]> = {}) =>
  reviewReturn({
    year: 2025,
    today: "2026-10-19",
    filed: { deductionKind: "standard" },
    input: input(),
    studentLoanInterestCents: 0,
    tuitionCents: 0,
    careCents: 0,
    children: [],
    ...over,
  });
const keys = (r: ReturnType<typeof review>) => r.findings.map((f) => f.key);
const tax = (i: EstimateInput) => estimateTaxes(i).totalTaxCents;

describe("the dependent care credit on a joint return", () => {
  const joint = input({ filingStatus: "married_joint" });
  const care = { input: joint, careCents: 300_000, children: [kid] };
  it("isn't counted when the household's work isn't known, or when one spouse doesn't work", () => {
    expect(keys(review(care))).not.toContain("dependent_care_credit");
    expect(keys(review({ ...care, bothWork: false }))).not.toContain("dependent_care_credit");
  });
  it("is counted when both work, and for a single filer the work fact isn't needed", () => {
    expect(keys(review({ ...care, bothWork: true }))).toContain("dependent_care_credit");
    expect(keys(review({ ...care, input: input() }))).toContain("dependent_care_credit");
  });
});

describe("the education credit without the student's facts", () => {
  const base = { tuitionCents: 400_000 };
  it("counts only the Lifetime Learning credit when the student's years aren't known", () => {
    const unknown = review(base).findings.find((f) => f.key === "education_credit")!;
    // 20% of $4,000.
    expect(unknown.savesCents).toBe(80_000);
    expect(unknown.why).toContain("Lifetime Learning");
    expect(unknown.why).toContain("haven't counted the American Opportunity");
  });
  it("counts the American Opportunity credit for a first-years half-time student", () => {
    const known = review({
      ...base,
      student: { yearsOfCollegeBefore: 0, halfTime: true },
    }).findings.find((f) => f.key === "education_credit")!;
    expect(known.savesCents).toBeGreaterThan(80_000);
  });
  it("falls back to Lifetime Learning for a student past four years or under half-time", () => {
    for (const student of [
      { yearsOfCollegeBefore: 4, halfTime: true },
      { yearsOfCollegeBefore: 1, halfTime: false },
    ]) {
      const f = review({ ...base, student }).findings.find((x) => x.key === "education_credit")!;
      expect(f.savesCents).toBe(80_000);
    }
  });
});

describe("the total over several credits", () => {
  it("doesn't count the same tax twice when the credits together exceed it", () => {
    // About $2,000 of federal tax: two credits that are each bigger than what's left.
    const small = input({
      income: { ...NO_INCOME, wagesCents: 2_500_000, socialSecurityWagesCents: 2_500_000 },
    });
    const owed = tax(small);
    const r = review({
      input: small,
      tuitionCents: 400_000,
      careCents: 600_000,
      children: [kid, kid],
      student: { yearsOfCollegeBefore: 4, halfTime: true },
    });
    expect(keys(r).sort()).toEqual(["dependent_care_credit", "education_credit"]);
    const sum = r.findings.reduce((s, f) => s + f.savesCents, 0);
    expect(sum).toBeGreaterThan(owed);
    expect(r.totalCents).toBeLessThanOrEqual(owed);
    expect(r.totalCents).toBe(owed);
  });
  it("still adds up credits that fit under the tax together", () => {
    const r = review({
      input: input({
        income: { ...NO_INCOME, wagesCents: 6_500_000, socialSecurityWagesCents: 6_500_000 },
      }),
      tuitionCents: 400_000,
      careCents: 300_000,
      children: [kid],
      student: { yearsOfCollegeBefore: 4, halfTime: true },
    });
    expect(r.findings).toHaveLength(2);
    expect(r.totalCents).toBe(r.findings.reduce((s, f) => s + f.savesCents, 0));
  });
});
