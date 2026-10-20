import {
  AMEND_MIN_CENTS,
  AMEND_WITHIN_YEARS,
  DEDUCTION_KINDS,
  PRIOR_RETURN_FIELDS,
  PRIOR_RETURN_YEARS_BACK,
  type PriorReturnFieldKey,
} from "@/config/prior-return";
import { FILING_STATUSES, TUITION_PAYEE, type FilingStatus } from "@/config/tax";
import { parseMoneyToCents } from "@/lib/money";
import { careChoice, educationChoice, type Child } from "@/planning/family-taxes";
import { estimateTaxes, type EstimateInput } from "@/planning/tax-estimate";

// Last year's return, read and reviewed (spec step 172). Pure. Two halves:
// - the reading rules: what Jane read off an uploaded return, checked before the person
//   sees it (a field that fails a rule is blank with a note);
// - the review: what the return claimed against what Jane knows for that year, and the
//   money left behind, each with the federal tax it would change.

export type Fields = Partial<Record<PriorReturnFieldKey, string>>;
export type Source = "document" | "you" | "profile";
export const SOURCE_WORDS: Record<Source, string> = {
  document: "from the document",
  you: "as you typed it",
  profile: "from your tax profile",
};

export type CheckedReading = {
  fields: Fields;
  sources: Partial<Record<PriorReturnFieldKey, Source>>;
  notes: Partial<Record<PriorReturnFieldKey, string>>;
};

const MAX_CENTS = 100_000_000_00;

export function checkPriorReturn(
  given: Fields,
  from: Partial<Record<PriorReturnFieldKey, Source>>,
  { today }: { today: string },
): CheckedReading {
  const fields: Fields = { ...given };
  const sources = { ...from };
  const notes: CheckedReading["notes"] = {};
  const drop = (key: PriorReturnFieldKey, note: string) => {
    delete fields[key];
    delete sources[key];
    notes[key] = note;
  };
  const thisYear = Number(today.slice(0, 4));
  if (fields.taxYear !== undefined) {
    const y = Number(fields.taxYear);
    if (!Number.isInteger(y) || y > thisYear - 1 || y < thisYear - PRIOR_RETURN_YEARS_BACK) {
      drop(
        "taxYear",
        `I can review returns for ${thisYear - PRIOR_RETURN_YEARS_BACK} to ${thisYear - 1}.`,
      );
    }
  }
  if (fields.filingStatus !== undefined && !(fields.filingStatus in FILING_STATUSES)) {
    drop("filingStatus", "Pick how you filed.");
  }
  if (fields.deductionKind !== undefined && !(fields.deductionKind in DEDUCTION_KINDS)) {
    drop("deductionKind", "Pick standard or itemized.");
  }
  for (const f of PRIOR_RETURN_FIELDS) {
    if (f.type !== "money" && f.type !== "signed") continue;
    const value = fields[f.key];
    if (value === undefined || value === "") continue;
    const cents = parseMoneyToCents(value);
    if (cents === null || Math.abs(cents) > MAX_CENTS || (f.type === "money" && cents < 0)) {
      drop(f.key, "I couldn't read that amount. Type it from your return.");
    }
  }
  if (
    fields.studentLoanInterest !== undefined &&
    (parseMoneyToCents(fields.studentLoanInterest) ?? 0) > 250_000
  ) {
    notes.studentLoanInterest = "The deduction is capped at $2,500: check this.";
  }
  return { fields, sources, notes };
}

// The cents in a field, or 0.
export const centsOf = (fields: Fields, key: PriorReturnFieldKey): number =>
  (fields[key] ? parseMoneyToCents(fields[key]!) : null) ?? 0;

export type Finding = {
  key: "itemize" | "student_loan_interest" | "education_credit" | "dependent_care_credit";
  title: string;
  why: string;
  // Federal tax that would have been saved (and so a refund).
  savesCents: number;
};

export type ReviewInput = {
  year: number;
  today: string;
  filed: Fields;
  // Jane's own estimate input for that year, and what she knows beyond it.
  input: EstimateInput;
  studentLoanInterestCents: number;
  tuitionCents: number;
  careCents: number;
  children: Child[];
};

export type Review = {
  year: number;
  findings: Finding[];
  totalCents: number;
  // The last day to amend, and whether it's still open.
  amendBy: string;
  canAmend: boolean;
  // Worth preparing: open, and adds up to at least AMEND_MIN_CENTS.
  worthAmending: boolean;
};

const dollars = (cents: number) =>
  `$${Math.round(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
const tax = (i: EstimateInput) => estimateTaxes(i).totalTaxCents;

export const amendBy = (year: number) => `${year + AMEND_WITHIN_YEARS + 1}-04-15`;

export function reviewReturn(r: ReviewInput): Review {
  const f = r.filed;
  const input = r.input;
  const base = tax(input);
  const findings: Finding[] = [];

  // Took the standard deduction, but Jane's itemized total is higher.
  if (f.deductionKind === "standard") {
    const e = estimateTaxes(input);
    if (e.deduction.kind === "itemized") {
      const standardOnly = tax({
        ...input,
        charityCents: 0,
        medicalCents: 0,
        mortgageInterestCents: 0,
        otherStateLocalTaxCents: 0,
        stateWithheldCents: 0,
        stateEstimatedPaidCents: 0,
      });
      findings.push({
        key: "itemize",
        title: "Itemizing would have beaten the standard deduction",
        why: `Your ${r.year} itemized deductions come to about ${dollars(e.deduction.itemizedCents)}, against the standard deduction of ${dollars(e.deduction.standardCents)}.`,
        savesCents: standardOnly - e.totalTaxCents,
      });
    }
  }

  if (centsOf(f, "studentLoanInterest") === 0 && r.studentLoanInterestCents > 0) {
    findings.push({
      key: "student_loan_interest",
      title: "Student loan interest wasn't deducted",
      why: `Your lender reported about ${dollars(r.studentLoanInterestCents)} of interest for ${r.year}; up to $2,500 comes off your income.`,
      savesCents: tax({ ...input, studentLoanInterestCents: 0 }) - base,
    });
  }

  const student = { yearsOfCollegeBefore: 0, halfTime: true };
  if (centsOf(f, "educationCredit") === 0 && r.tuitionCents > 0) {
    const c = educationChoice({ estimate: input, tuitionCents: r.tuitionCents, student });
    const best = c ? Math.min(...c.sides.filter((s) => s.eligible).map((s) => s.taxCents)) : base;
    findings.push({
      key: "education_credit",
      title: "An education credit wasn't claimed",
      why: `You paid about ${dollars(r.tuitionCents)} in tuition in ${r.year}. The better of the American Opportunity and Lifetime Learning credits would have lowered your tax.`,
      savesCents: base - best,
    });
  }

  if (centsOf(f, "dependentCareCredit") === 0 && r.careCents > 0 && r.children.length > 0) {
    const c = careChoice({
      estimate: input,
      careCents: r.careCents,
      children: r.children,
      bothWork: true,
    });
    if (c?.sides[1].eligible) {
      findings.push({
        key: "dependent_care_credit",
        title: "The child and dependent care credit wasn't claimed",
        why: `You paid about ${dollars(r.careCents)} for childcare in ${r.year}, and the credit is a share of it.`,
        savesCents: base - c.sides[1].taxCents,
      });
    }
  }

  const real = findings.filter((x) => x.savesCents > 0);
  const totalCents = real.reduce((s, x) => s + x.savesCents, 0);
  const by = amendBy(r.year);
  const canAmend = r.today <= by;
  return {
    year: r.year,
    findings: real,
    totalCents,
    amendBy: by,
    canAmend,
    worthAmending: canAmend && totalCents >= AMEND_MIN_CENTS,
  };
}

export { TUITION_PAYEE };
export type { FilingStatus };
