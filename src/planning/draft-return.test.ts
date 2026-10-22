import { describe, expect, it } from "vitest";
import { NO_INCOME, type EstimateInput } from "@/planning/tax-estimate";
import { checkDraft, demoDraft, reviewDraft, type DraftFields, type Known } from "./draft-return";

// Spec step 272: a draft return's reading rules, its check line by line against what Jane knows,
// and the demo draft's three planted mistakes, all found.

const $ = (d: number) => Math.round(d * 100);

const input: EstimateInput = {
  year: 2026,
  filingStatus: "single",
  childrenUnder17: 0,
  otherDependants: 0,
  state: null,
  income: {
    ...NO_INCOME,
    wagesCents: $(71_360),
    socialSecurityWagesCents: $(76_100),
    interestCents: $(450),
    dividendsCents: $(1_200),
    qualifiedDividendsCents: $(900),
    longTermGainsCents: $(1_116),
  },
  studentLoanInterestCents: $(806),
  mortgageInterestCents: 0,
  charityCents: 0,
  medicalCents: 0,
  otherStateLocalTaxCents: 0,
  federalWithheldCents: $(11_311),
  federalEstimatedPaidCents: 0,
  stateWithheldCents: 0,
  stateEstimatedPaidCents: 0,
};

const known: Known = {
  year: 2026,
  input,
  w2WagesCents: $(71_360),
  withheldCents: $(11_311),
  interestCents: $(450),
  dividendsCents: $(1_200),
  gainsCents: $(1_116),
  businessCents: 0,
  estimatedPaidCents: 0,
  studentLoanInterestCents: $(806),
  tuitionCents: 0,
  careCents: 0,
  children: [],
  from: { wages: "Your W-2 from ACME", federalWithheld: "Your W-2 from ACME" },
};

const right: DraftFields = {
  taxYear: "2026",
  filingStatus: "single",
  wages: "71360",
  interest: "450",
  dividends: "1200",
  capitalGains: "1116",
  businessIncome: "0",
  deductionKind: "standard",
  studentLoanInterest: "806",
  federalWithheld: "11311",
  estimatedPaid: "0",
};

describe("reading a draft", () => {
  it("keeps a year that has ended, and drops what fails a rule with a note", () => {
    const r = checkDraft(
      { ...right, taxYear: "2027", wages: "seventy", filingStatus: "joint" },
      { wages: "document" },
      { today: "2027-03-01" },
    );
    expect(r.fields.taxYear).toBeUndefined();
    expect(r.notes.taxYear).toBe("I check drafts for 2025 and 2026.");
    expect(r.notes.wages).toMatch(/couldn't read that amount/);
    expect(r.sources.wages).toBeUndefined();
    expect(r.notes.filingStatus).toBeDefined();
    expect(checkDraft(right, {}, { today: "2027-03-01" }).notes).toEqual({});
  });
});

describe("checking a draft against what Jane knows", () => {
  it("finds nothing in a right draft (rounding to dollars is fine)", () => {
    expect(reviewDraft({ ...right, wages: "71359.40" }, known)).toEqual([]);
  });

  it("finds income missing, with the tax it would bring", () => {
    const f = reviewDraft({ ...right, dividends: "0" }, known);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({
      key: "dividends",
      kind: "income_missing",
      line: "Form 1040 line 3b",
      draftCents: 0,
      knownCents: $(1_200),
      effect: "owes",
    });
    expect(f[0].dollarsCents).toBeGreaterThan(0);
  });

  it("finds withholding that doesn't match the W-2, dollar for dollar", () => {
    const f = reviewDraft({ ...right, federalWithheld: "10311" }, known);
    expect(f).toEqual([
      expect.objectContaining({
        key: "federalWithheld",
        kind: "mismatch",
        effect: "saves",
        dollarsCents: $(1_000),
      }),
    ]);
    expect(f[0].why).toContain("Your W-2 from ACME shows $11,311 withheld");
  });

  it("finds a deduction left out and estimated payments left off", () => {
    const f = reviewDraft(
      { ...right, studentLoanInterest: "0", estimatedPaid: "0" },
      { ...known, estimatedPaidCents: $(2_000) },
    );
    expect(f.map((x) => [x.key, x.kind, x.effect])).toEqual([
      ["estimatedPaid", "left_out", "saves"],
      ["student_loan_interest", "left_out", "saves"],
    ]);
    expect(f[0].dollarsCents).toBe($(2_000));
  });

  it("finds wages lower than the W-2 as missing income", () => {
    const f = reviewDraft({ ...right, wages: "61360" }, known);
    expect(f[0]).toMatchObject({ key: "wages", kind: "income_missing", effect: "owes" });
  });
});

describe("the demo draft", () => {
  it("has three planted mistakes, and the check finds all three and nothing else", () => {
    const { fields, planted } = demoDraft(known);
    expect(planted).toEqual(["dividends", "federalWithheld", "student_loan_interest"]);
    const found = reviewDraft(fields, known).map((f) => f.key);
    expect([...found].sort()).toEqual([...planted].sort());
  });

  it("plants the next income it can when there are no dividends: interest, then gains", () => {
    const noDividends = {
      ...known,
      dividendsCents: 0,
      input: {
        ...input,
        income: { ...input.income, dividendsCents: 0, qualifiedDividendsCents: 0 },
      },
    };
    expect(demoDraft(noDividends).planted[0]).toBe("interest");
    const onlyGains = {
      ...noDividends,
      interestCents: 0,
      input: { ...noDividends.input, income: { ...noDividends.input.income, interestCents: 0 } },
    };
    const d = demoDraft(onlyGains);
    expect(d.planted).toEqual(["capitalGains", "federalWithheld", "student_loan_interest"]);
    expect(
      reviewDraft(d.fields, onlyGains)
        .map((f) => f.key)
        .sort(),
    ).toEqual([...d.planted].sort());
  });
});
