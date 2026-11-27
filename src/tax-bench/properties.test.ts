import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { FilingStatus } from "@/config/tax";
import { federalParams } from "@/config/tax-params";
import {
  childCredits,
  estimateTaxes,
  incomeTax,
  selfEmploymentTax,
  type EstimateInput,
  type TaxEstimate,
} from "@/planning/tax-estimate";
import { inputOf } from "./serialize";

// Tax T2: properties that hold for any person, on today's estimator and 2026 law. 200 runs each.
// The properties that need the rule engine (an unknown fact never turns a no into a yes, a child
// claimed twice is refused, a range holds its point) come with T11 to T13 and T23.

const P = federalParams(2026);
const RUNS = { numRuns: 200 };
const STATUS = fc.constantFrom<FilingStatus>(
  "single",
  "married_joint",
  "married_separate",
  "head_of_household",
);
const money = (max: number) => fc.integer({ min: 0, max });
const signed = (max: number) => fc.integer({ min: -max, max });

const person = fc
  .record({
    status: STATUS,
    children: fc.integer({ min: 0, max: 4 }),
    others: fc.integer({ min: 0, max: 3 }),
    age: fc.option(fc.integer({ min: 16, max: 95 }), { nil: null }),
    wages: money(150_000_000),
    se: money(50_000_000),
    interest: money(20_000_000),
    dividends: money(20_000_000),
    qualifiedShare: fc.double({ min: 0, max: 1, noNaN: true }),
    shortTerm: signed(20_000_000),
    longTerm: signed(20_000_000),
    rental: signed(10_000_000),
    retirement: money(60_000_000),
    unemployment: money(10_000_000),
    benefits: money(5_000_000),
    studentLoan: money(500_000),
    mortgage: money(4_000_000),
    charity: money(4_000_000),
    medical: money(4_000_000),
    salt: money(8_000_000),
    withheld: money(50_000_000),
    amtPreference: money(30_000_000),
  })
  .map((x) =>
    inputOf(
      2026,
      x.status,
      {
        wagesCents: x.wages,
        selfEmploymentCents: x.se,
        interestCents: x.interest,
        dividendsCents: x.dividends,
        qualifiedDividendsCents: Math.floor(x.dividends * x.qualifiedShare),
        shortTermGainsCents: x.shortTerm,
        longTermGainsCents: x.longTerm,
        rentalCents: x.rental,
        retirementCents: x.retirement,
        unemploymentCents: x.unemployment,
        socialSecurityBenefitsCents: x.benefits,
      },
      {
        childrenUnder17: x.children,
        otherDependants: x.others,
        age: x.age,
        studentLoanInterestCents: x.studentLoan,
        mortgageInterestCents: x.mortgage,
        charityCents: x.charity,
        medicalCents: x.medical,
        otherStateLocalTaxCents: x.salt,
        federalWithheldCents: x.withheld,
        amtPreferenceCents: x.amtPreference,
      },
    ),
  );

const refundable = (e: TaxEstimate) =>
  e.credits.additionalChildTaxCreditCents + e.credits.earnedIncomeCreditCents;
// What the person owes before refundable credits and payments (never negative).
const beforeRefundable = (e: TaxEstimate) => e.totalTaxCents + refundable(e);

const deepFreeze = <T>(v: T): T => {
  if (v && typeof v === "object") Object.values(v).forEach(deepFreeze);
  return Object.freeze(v);
};

describe("the estimate, for any person", () => {
  it("owes nothing negative before refundable credits, and refund is paid less total", () => {
    fc.assert(
      fc.property(person, (input) => {
        const e = estimateTaxes(input);
        expect(beforeRefundable(e)).toBeGreaterThanOrEqual(0);
        expect(e.refundCents).toBe(e.paidCents - e.totalTaxCents);
      }),
      RUNS,
    );
  });

  it("keeps every credit at or above zero and within its cap", () => {
    fc.assert(
      fc.property(person, (input) => {
        const c = estimateTaxes(input).credits;
        const n = Math.min(3, input.childrenUnder17) as 0 | 1 | 2 | 3;
        expect(c.childTaxCreditCents).toBeGreaterThanOrEqual(0);
        expect(c.childTaxCreditCents).toBeLessThanOrEqual(
          input.childrenUnder17 * P.ctc.value.perChild,
        );
        expect(c.otherDependantCreditCents).toBeGreaterThanOrEqual(0);
        expect(c.otherDependantCreditCents).toBeLessThanOrEqual(
          input.otherDependants * P.ctc.value.otherDependant,
        );
        expect(c.additionalChildTaxCreditCents).toBeGreaterThanOrEqual(0);
        expect(c.additionalChildTaxCreditCents).toBeLessThanOrEqual(
          input.childrenUnder17 * P.ctc.value.refundablePerChild,
        );
        expect(c.earnedIncomeCreditCents).toBeGreaterThanOrEqual(0);
        expect(c.earnedIncomeCreditCents).toBeLessThanOrEqual(P.eitc.value.maxCredit[n]);
      }),
      RUNS,
    );
  });

  it("gives the earned income credit only to people the law allows it to", () => {
    fc.assert(
      fc.property(person, (input) => {
        const e = estimateTaxes(input);
        if (e.credits.earnedIncomeCreditCents === 0) return;
        expect(input.filingStatus).not.toBe("married_separate");
        expect(input.income.wagesCents + input.income.selfEmploymentCents).toBeGreaterThan(0);
        if (input.childrenUnder17 === 0) {
          expect(input.age).toBeGreaterThanOrEqual(P.eitc.value.childlessMinAge);
          expect(input.age).toBeLessThanOrEqual(P.eitc.value.childlessMaxAge);
        }
      }),
      RUNS,
    );
  });

  it("counts between none and 85% of Social Security benefits", () => {
    fc.assert(
      fc.property(person, (input) => {
        const e = estimateTaxes(input);
        expect(e.socialSecurityTaxableCents).toBeGreaterThanOrEqual(0);
        expect(e.socialSecurityTaxableCents).toBeLessThanOrEqual(
          Math.round((input.income.socialSecurityBenefitsCents ?? 0) * 0.85),
        );
      }),
      RUNS,
    );
  });

  it("gives the same answer twice and leaves its input alone", () => {
    fc.assert(
      fc.property(person, (input) => {
        const frozen = deepFreeze(structuredClone(input));
        expect(estimateTaxes(frozen)).toEqual(estimateTaxes(structuredClone(input)));
      }),
      RUNS,
    );
  });

  it("owes no less before refundable credits as wages rise (nothing else changing)", () => {
    fc.assert(
      fc.property(person, money(100_000_000), (input, more) => {
        // Charity is held at zero: today the estimator picks itemizing or the standard deduction
        // before it adds the non-itemizer gift deduction, so more wages can flip a person from
        // itemizing to standard plus gifts and lower the tax (the HE-4 expected failure, T6).
        const base: EstimateInput = {
          ...input,
          charityCents: 0,
          income: { ...input.income, selfEmploymentCents: 0 },
        };
        const raised: EstimateInput = {
          ...base,
          income: {
            ...base.income,
            wagesCents: base.income.wagesCents + more,
            socialSecurityWagesCents: base.income.socialSecurityWagesCents + more,
          },
        };
        expect(beforeRefundable(estimateTaxes(raised))).toBeGreaterThanOrEqual(
          beforeRefundable(estimateTaxes(base)),
        );
      }),
      RUNS,
    );
  });
});

describe("the pieces, for any income", () => {
  const taxable = money(200_000_000);

  it("taxes ordinary income no less as it rises, never above the top rate", () => {
    fc.assert(
      fc.property(STATUS, taxable, taxable, (s, x, y) => {
        const [lo, hi] = x <= y ? [x, y] : [y, x];
        expect(incomeTax(hi, 0, s)).toBeGreaterThanOrEqual(incomeTax(lo, 0, s));
        expect(incomeTax(hi, 0, s)).toBeLessThanOrEqual(Math.round(hi * 0.37));
      }),
      RUNS,
    );
  });

  it("taxes ordinary income plus gains no less as the ordinary part rises", () => {
    fc.assert(
      fc.property(STATUS, taxable, taxable, money(50_000_000), (s, x, y, gains) => {
        const [lo, hi] = x <= y ? [x, y] : [y, x];
        // Gains sit on top, so taxable income is the ordinary part plus the gains.
        expect(incomeTax(hi + gains, gains, s)).toBeGreaterThanOrEqual(
          incomeTax(lo + gains, gains, s),
        );
      }),
      RUNS,
    );
  });

  it("never takes the gains rates above what taxing it all as ordinary would", () => {
    fc.assert(
      fc.property(STATUS, taxable, money(200_000_000), (s, x, gains) => {
        expect(incomeTax(x, gains, s)).toBeLessThanOrEqual(incomeTax(x, 0, s));
      }),
      RUNS,
    );
  });

  it("takes self-employment tax no less as earnings rise", () => {
    fc.assert(
      fc.property(taxable, taxable, money(30_000_000), (x, y, ssWages) => {
        const [lo, hi] = x <= y ? [x, y] : [y, x];
        expect(selfEmploymentTax(hi, ssWages)).toBeGreaterThanOrEqual(
          selfEmploymentTax(lo, ssWages),
        );
      }),
      RUNS,
    );
  });

  it("takes the earned income credit away as income rises, to nothing past where it ends", () => {
    fc.assert(
      fc.property(fc.constantFrom(0, 1, 2, 3), money(6_000_000), money(6_000_000), (n, x, y) => {
        const from = P.eitc.value.phaseOutFrom.single[n];
        const end = from + Math.round(P.eitc.value.maxCredit[n] / P.eitc.value.phaseOutRate[n]);
        const at = (earned: number) =>
          estimateTaxes(
            inputOf(2026, "single", { wagesCents: earned }, { childrenUnder17: n, age: 30 }),
          ).credits.earnedIncomeCreditCents;
        const [lo, hi] = [from + Math.min(x, y), from + Math.max(x, y)];
        expect(at(hi)).toBeLessThanOrEqual(at(lo));
        if (hi >= end + 100) expect(at(hi)).toBe(0);
      }),
      RUNS,
    );
  });

  it("takes the child credits away as income rises, to nothing once they are used up", () => {
    fc.assert(
      fc.property(
        STATUS,
        fc.integer({ min: 1, max: 4 }),
        money(20_000_000),
        money(20_000_000),
        (s, children, x, y) => {
          const ctc = P.ctc.value;
          const total = (agiCents: number) => {
            const c = childCredits({
              status: s,
              children,
              others: 0,
              agiCents,
              earnedCents: 100_000_000,
              taxBeforeCreditsCents: 1_000_000_000,
            });
            return c.childCents + c.otherCents + c.refundableCents;
          };
          const from = ctc.phaseOutFrom[s];
          const [lo, hi] = [from + Math.min(x, y), from + Math.max(x, y)];
          expect(total(hi)).toBeLessThanOrEqual(total(lo));
          // $50 off for each $1,000 over: the credit is gone after (credit / $50) thousands.
          const gone = (children * ctc.perChild * ctc.phaseOutStep) / ctc.phaseOutPerStep;
          if (hi >= from + gone + ctc.phaseOutStep) expect(total(hi)).toBe(0);
        },
      ),
      RUNS,
    );
  });
});
