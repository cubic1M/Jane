import { describe, expect, it } from "vitest";
import { AMEND_MIN_CENTS } from "@/config/prior-return";
import { NO_INCOME, estimateTaxes, type EstimateInput } from "./tax-estimate";
import { amendBy, checkPriorReturn, reviewReturn } from "./prior-return";

// Spec step 172: a return read from a document is checked by rules; the review finds money
// left behind; the time to amend is bounded.

const TODAY = "2026-10-19";

describe("reading a return", () => {
  it("keeps good fields with their source and drops the ones that fail a rule, with a note", () => {
    const c = checkPriorReturn(
      {
        taxYear: "2025",
        filingStatus: "single",
        agi: "85,000.50",
        deductionKind: "standard",
        deduction: "lots",
        studentLoanInterest: "3,000",
        refund: "-1,200",
      },
      { taxYear: "document", agi: "document", refund: "you" },
      { today: TODAY },
    );
    expect(c.fields).toMatchObject({ taxYear: "2025", agi: "85,000.50", refund: "-1,200" });
    expect(c.fields.deduction).toBeUndefined();
    expect(c.notes.deduction).toBe("I couldn't read that amount. Type it from your return.");
    expect(c.notes.studentLoanInterest).toBe("The deduction is capped at $2,500: check this.");
    expect(c.sources.agi).toBe("document");
  });

  it("only reviews recent years, real statuses and kinds", () => {
    const c = checkPriorReturn(
      { taxYear: "2019", filingStatus: "widow", deductionKind: "both", agi: "-5" },
      {},
      { today: TODAY },
    );
    expect(c.fields).toEqual({});
    expect(Object.keys(c.notes).sort()).toEqual([
      "agi",
      "deductionKind",
      "filingStatus",
      "taxYear",
    ]);
    expect(checkPriorReturn({ taxYear: "2026" }, {}, { today: TODAY }).notes.taxYear).toBeDefined();
  });
});

const input = (over: Partial<EstimateInput> = {}): EstimateInput => ({
  year: 2025,
  filingStatus: "single",
  childrenUnder17: 0,
  otherDependants: 0,
  state: "TX",
  income: { ...NO_INCOME, wagesCents: 6_500_000, socialSecurityWagesCents: 6_500_000 },
  studentLoanInterestCents: 0,
  mortgageInterestCents: 2_400_000,
  charityCents: 800_000,
  medicalCents: 0,
  otherStateLocalTaxCents: 600_000,
  federalWithheldCents: 0,
  federalEstimatedPaidCents: 0,
  stateWithheldCents: 0,
  stateEstimatedPaidCents: 0,
  ...over,
});
const review = (over: Partial<Parameters<typeof reviewReturn>[0]> = {}) =>
  reviewReturn({
    year: 2025,
    today: TODAY,
    filed: { deductionKind: "standard" },
    input: input(),
    studentLoanInterestCents: 0,
    tuitionCents: 0,
    careCents: 0,
    children: [],
    ...over,
  });

describe("reviewing a return", () => {
  it("finds that itemizing would have beaten the standard deduction, and what it was worth", () => {
    const r = review();
    expect(r.findings.map((f) => f.key)).toEqual(["itemize"]);
    const e = estimateTaxes(input());
    expect(e.deduction.kind).toBe("itemized");
    const standardOnly = estimateTaxes(
      input({ charityCents: 0, mortgageInterestCents: 0, otherStateLocalTaxCents: 0 }),
    ).totalTaxCents;
    expect(r.findings[0].savesCents).toBe(standardOnly - e.totalTaxCents);
    expect(r.worthAmending).toBe(true);
    // Not if they itemized.
    expect(review({ filed: { deductionKind: "itemized" } }).findings).toEqual([]);
  });

  it("finds a student loan interest deduction, an education credit and the care credit", () => {
    const r = review({
      filed: { deductionKind: "itemized" },
      input: input({ mortgageInterestCents: 0, charityCents: 0, otherStateLocalTaxCents: 0 }),
      studentLoanInterestCents: 180_000,
      tuitionCents: 400_000,
      careCents: 300_000,
      children: [{ ageAtYearEnd: 4, hasSsn: true, monthsLivedWithYou: 12 }],
    });
    expect(r.findings.map((f) => f.key).sort()).toEqual([
      "dependent_care_credit",
      "education_credit",
      "student_loan_interest",
    ]);
    for (const f of r.findings) expect(f.savesCents, f.key).toBeGreaterThan(0);
    // Not when the return already claimed them.
    const claimed = review({
      filed: {
        deductionKind: "itemized",
        studentLoanInterest: "1,800",
        educationCredit: "800",
        dependentCareCredit: "300",
      },
      input: input({ mortgageInterestCents: 0, charityCents: 0, otherStateLocalTaxCents: 0 }),
      studentLoanInterestCents: 180_000,
      tuitionCents: 400_000,
      careCents: 300_000,
      children: [{ ageAtYearEnd: 4, hasSsn: true, monthsLivedWithYou: 12 }],
    });
    expect(claimed.findings).toEqual([]);
  });

  it("amends within 3 years of the filing deadline, and only when worth it", () => {
    expect(amendBy(2022)).toBe("2026-04-15");
    expect(review({ year: 2022, today: "2026-04-16" }).canAmend).toBe(false);
    expect(review({ year: 2022, today: "2026-04-16" }).worthAmending).toBe(false);
    expect(review({ year: 2025, today: "2026-04-15" }).canAmend).toBe(true);
    const small = review({
      filed: { deductionKind: "itemized" },
      input: input({ mortgageInterestCents: 0, charityCents: 0, otherStateLocalTaxCents: 0 }),
      studentLoanInterestCents: 5_000,
    });
    expect(small.totalCents).toBeLessThan(AMEND_MIN_CENTS);
    expect(small.worthAmending).toBe(false);
  });
});
