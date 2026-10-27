import {
  DEMO_WITHHOLDING_SLIP_CENTS,
  DRAFT_FIELDS,
  DRAFT_MIN_FINDING_CENTS,
  DRAFT_TOLERANCE,
  type DraftFieldKey,
} from "@/config/draft-return";
import { DEDUCTION_KINDS } from "@/config/prior-return";
import { FILING_STATUSES } from "@/config/tax";
import { parseMoneyToCents, formatWholeDollars } from "@/lib/money";
import { reviewReturn, type Fields as PriorFields } from "@/planning/prior-return";
import type { Child } from "@/planning/family-taxes";
import { estimateTaxes, type EstimateInput } from "@/planning/tax-estimate";

// The return, checked before you file (spec step 272). Pure. Three parts:
// - the reading rules: a draft read off an uploaded PDF, checked before the person confirms it;
// - the review: each line against what Jane knows for the year (the forms it collected, the
//   accounts, the estimate): income missing, deductions or credits left out, figures that don't
//   match the forms, each with the tax it changes;
// - the demo draft: the stand-in reader's draft for demo-bank people, built from their own
//   figures with three mistakes planted.

export type DraftFields = Partial<Record<DraftFieldKey, string>>;
export type DraftSource = "document" | "you" | "profile" | "demo";

export type CheckedDraft = {
  fields: DraftFields;
  sources: Partial<Record<DraftFieldKey, DraftSource>>;
  notes: Partial<Record<DraftFieldKey, string>>;
};

const MAX_CENTS = 100_000_000_00;

export function checkDraft(
  given: DraftFields,
  from: Partial<Record<DraftFieldKey, DraftSource>>,
  { today }: { today: string },
): CheckedDraft {
  const fields: DraftFields = { ...given };
  const sources = { ...from };
  const notes: CheckedDraft["notes"] = {};
  const drop = (key: DraftFieldKey, note: string) => {
    delete fields[key];
    delete sources[key];
    notes[key] = note;
  };
  const thisYear = Number(today.slice(0, 4));
  if (fields.taxYear !== undefined) {
    const y = Number(fields.taxYear);
    // A draft is for a year that has ended and not long ago (a late or extended return).
    if (!Number.isInteger(y) || y > thisYear - 1 || y < thisYear - 2) {
      drop("taxYear", `I check drafts for ${thisYear - 2} and ${thisYear - 1}.`);
    }
  }
  if (fields.filingStatus !== undefined && !(fields.filingStatus in FILING_STATUSES)) {
    drop("filingStatus", "Pick the filing status on the draft.");
  }
  if (fields.deductionKind !== undefined && !(fields.deductionKind in DEDUCTION_KINDS)) {
    drop("deductionKind", "Pick standard or itemized.");
  }
  for (const f of DRAFT_FIELDS) {
    if (f.type !== "money" && f.type !== "signed") continue;
    const value = fields[f.key];
    if (value === undefined || value === "") continue;
    const cents = parseMoneyToCents(value);
    if (cents === null || Math.abs(cents) > MAX_CENTS || (f.type === "money" && cents < 0)) {
      drop(f.key, "I couldn't read that amount. Type it from the draft.");
    }
  }
  return { fields, sources, notes };
}

export const draftCents = (fields: DraftFields, key: DraftFieldKey): number =>
  (fields[key] ? parseMoneyToCents(fields[key]!) : null) ?? 0;

// What Jane knows for the year, and where from.
export type Known = {
  year: number;
  // Its estimate input for the year (the tax effects are worked out on it).
  input: EstimateInput;
  // From the forms it collected (usable ones only), or null when there's no form.
  w2WagesCents: number | null;
  withheldCents: number | null;
  interestCents: number;
  dividendsCents: number;
  // Short and long-term gains together (the brokerage's 1099-B, or the accounts).
  gainsCents: number;
  businessCents: number;
  estimatedPaidCents: number;
  studentLoanInterestCents: number;
  tuitionCents: number;
  careCents: number;
  children: Child[];
  // Where each figure came from, in words ("your W-2 from ACME CORP PAYROLL").
  from: Partial<Record<DraftFieldKey, string>>;
};

export type DraftFinding = {
  key: string;
  kind: "income_missing" | "left_out" | "mismatch";
  title: string;
  line: string;
  draftCents: number;
  knownCents: number;
  // The federal tax it changes: "owes" (a bill and a letter later if it isn't fixed) or "saves"
  // (money the draft leaves behind).
  effect: "owes" | "saves";
  dollarsCents: number;
  why: string;
};

const differs = (a: number, b: number) =>
  Math.abs(a - b) > Math.max(DRAFT_TOLERANCE.cents, Math.abs(b) * DRAFT_TOLERANCE.share);
const tax = (i: EstimateInput) => estimateTaxes(i).totalTaxCents;
const lineOf = (key: DraftFieldKey) => DRAFT_FIELDS.find((f) => f.key === key)!.line;

export function reviewDraft(fields: DraftFields, known: Known): DraftFinding[] {
  const out: DraftFinding[] = [];
  const input = known.input;
  const base = tax(input);
  const income = (
    key: "interest" | "dividends" | "capitalGains" | "businessIncome",
    knownCents: number,
    what: string,
    change: (i: EstimateInput, cents: number) => EstimateInput,
  ) => {
    if (fields[key] === undefined) return;
    const on = draftCents(fields, key);
    if (!differs(on, knownCents) || on >= knownCents) return;
    out.push({
      key,
      kind: "income_missing",
      title: `${what} is missing from the draft`,
      line: lineOf(key),
      draftCents: on,
      knownCents,
      effect: "owes",
      dollarsCents: base - tax(change(input, on)),
      why: `${known.from[key] ?? "Your accounts"} show${known.from[key] ? "s" : ""} ${formatWholeDollars(knownCents)} of ${what.toLowerCase()} for ${known.year}; the draft has ${formatWholeDollars(on)} on ${lineOf(key)}. The IRS gets the same form, so leaving it out brings a bill with interest later.`,
    });
  };
  income("interest", known.interestCents, "Interest", (i, c) => ({
    ...i,
    income: { ...i.income, interestCents: c },
  }));
  income("dividends", known.dividendsCents, "Dividend income", (i, c) => ({
    ...i,
    income: {
      ...i.income,
      dividendsCents: c,
      qualifiedDividendsCents: Math.min(i.income.qualifiedDividendsCents, c),
    },
  }));
  income("capitalGains", known.gainsCents, "Capital gains", (i, c) => {
    const all = i.income.shortTermGainsCents + i.income.longTermGainsCents;
    const k = all > 0 ? c / all : 0;
    return {
      ...i,
      income: {
        ...i.income,
        shortTermGainsCents: Math.round(i.income.shortTermGainsCents * k),
        longTermGainsCents: Math.round(i.income.longTermGainsCents * k),
      },
    };
  });
  income("businessIncome", known.businessCents, "Business income", (i, c) => ({
    ...i,
    income: { ...i.income, selfEmploymentCents: c },
  }));

  // Wages against the W-2s.
  if (known.w2WagesCents !== null && fields.wages !== undefined) {
    const on = draftCents(fields, "wages");
    if (differs(on, known.w2WagesCents)) {
      const lower = on < known.w2WagesCents;
      const changed = tax({ ...input, income: { ...input.income, wagesCents: on } });
      out.push({
        key: "wages",
        kind: lower ? "income_missing" : "mismatch",
        title: lower ? "Wages are lower than your W-2" : "Wages don't match your W-2",
        line: lineOf("wages"),
        draftCents: on,
        knownCents: known.w2WagesCents,
        effect: lower ? "owes" : "saves",
        dollarsCents: Math.abs(base - changed),
        why: `${known.from.wages ?? "Your W-2"} says ${formatWholeDollars(known.w2WagesCents)} in box 1; the draft has ${formatWholeDollars(on)} on ${lineOf("wages")}.`,
      });
    }
  }

  // Withholding against the forms: every dollar is a dollar of refund or bill.
  if (known.withheldCents !== null && fields.federalWithheld !== undefined) {
    const on = draftCents(fields, "federalWithheld");
    if (differs(on, known.withheldCents)) {
      const lower = on < known.withheldCents;
      out.push({
        key: "federalWithheld",
        kind: "mismatch",
        title: "Federal tax withheld doesn't match your forms",
        line: lineOf("federalWithheld"),
        draftCents: on,
        knownCents: known.withheldCents,
        effect: lower ? "saves" : "owes",
        dollarsCents: Math.abs(known.withheldCents - on),
        why: `${known.from.federalWithheld ?? "Your W-2 and 1099s"} show${known.from.federalWithheld ? "s" : ""} ${formatWholeDollars(known.withheldCents)} withheld; the draft has ${formatWholeDollars(on)} on ${lineOf("federalWithheld")}, so its ${lower ? "refund is too small" : "refund is too big and the IRS would take it back"} by ${formatWholeDollars(Math.abs(known.withheldCents - on))}.`,
      });
    }
  }

  // Estimated payments the person made.
  if (known.estimatedPaidCents > 0) {
    const on = draftCents(fields, "estimatedPaid");
    if (differs(on, known.estimatedPaidCents) && on < known.estimatedPaidCents) {
      out.push({
        key: "estimatedPaid",
        kind: "left_out",
        title: "Estimated tax payments are left off",
        line: lineOf("estimatedPaid"),
        draftCents: on,
        knownCents: known.estimatedPaidCents,
        effect: "saves",
        dollarsCents: known.estimatedPaidCents - on,
        why: `You paid ${formatWholeDollars(known.estimatedPaidCents)} of estimated tax for ${known.year}; the draft counts ${formatWholeDollars(on)} on ${lineOf("estimatedPaid")}, so you'd pay it twice.`,
      });
    }
  }

  // Deductions and credits left out: the same checks as last year's return (step 172).
  const prior: PriorFields = {
    deductionKind: fields.deductionKind,
    studentLoanInterest: fields.studentLoanInterest ?? "0",
    educationCredit: fields.educationCredit ?? "0",
    dependentCareCredit: fields.dependentCareCredit ?? "0",
  };
  const review = reviewReturn({
    year: known.year,
    today: `${known.year + 1}-01-01`,
    filed: prior,
    input,
    studentLoanInterestCents: known.studentLoanInterestCents,
    tuitionCents: known.tuitionCents,
    careCents: known.careCents,
    children: known.children,
  });
  const KEY_LINE: Record<string, DraftFieldKey> = {
    itemize: "deductionKind",
    student_loan_interest: "studentLoanInterest",
    education_credit: "educationCredit",
    dependent_care_credit: "dependentCareCredit",
  };
  for (const f of review.findings) {
    const key = KEY_LINE[f.key];
    out.push({
      key: f.key,
      kind: "left_out",
      title: f.title
        .replace("wasn't deducted", "isn't deducted")
        .replace("wasn't claimed", "isn't claimed")
        .replace("would have beaten", "beats"),
      line: lineOf(key),
      draftCents: draftCents(fields, key),
      knownCents: f.key === "student_loan_interest" ? known.studentLoanInterestCents : f.savesCents,
      effect: "saves",
      dollarsCents: f.savesCents,
      why: f.why,
    });
  }
  return out
    .filter((x) => x.dollarsCents >= DRAFT_MIN_FINDING_CENTS)
    .sort((a, b) => b.dollarsCents - a.dollarsCents || a.key.localeCompare(b.key));
}

// The demo draft: what tax software would fill in from the person's own figures, with three
// mistakes planted the way they happen (a 1099 forgotten, a withholding figure mistyped, a
// deduction or payment left off). For the stand-in reader only; a real draft is read off the
// person's PDF.
export function demoDraft(known: Known): { fields: DraftFields; planted: string[] } {
  const i = known.input;
  const planted: string[] = [];
  let interest = known.interestCents;
  let dividends = known.dividendsCents;
  let gains = known.gainsCents;
  const big = DRAFT_MIN_FINDING_CENTS * 4;
  if (dividends > big) {
    dividends = 0;
    planted.push("dividends");
  } else if (interest > big) {
    interest = 0;
    planted.push("interest");
  } else if (gains > big) {
    gains = 0;
    planted.push("capitalGains");
  }
  let withheld = known.withheldCents ?? i.federalWithheldCents;
  if (withheld > DEMO_WITHHOLDING_SLIP_CENTS) {
    withheld -= DEMO_WITHHOLDING_SLIP_CENTS;
    planted.push("federalWithheld");
  }
  let student = Math.min(known.studentLoanInterestCents, 250_000);
  let estimated = known.estimatedPaidCents;
  if (student > 0) {
    student = 0;
    planted.push("student_loan_interest");
  } else if (estimated > 0) {
    estimated = 0;
    planted.push("estimatedPaid");
  }
  const asDrafted: EstimateInput = {
    ...i,
    income: {
      ...i.income,
      interestCents: interest,
      dividendsCents: dividends,
      qualifiedDividendsCents: Math.min(i.income.qualifiedDividendsCents, dividends),
      shortTermGainsCents: gains === known.gainsCents ? i.income.shortTermGainsCents : 0,
      longTermGainsCents: gains === known.gainsCents ? i.income.longTermGainsCents : 0,
    },
    studentLoanInterestCents: student,
    federalWithheldCents: withheld,
    federalEstimatedPaidCents: estimated,
  };
  const e = estimateTaxes(asDrafted);
  const money = (cents: number) => (cents / 100).toFixed(2);
  // The credits the software would claim on its own (not planted mistakes).
  const credits = reviewReturn({
    year: known.year,
    today: `${known.year + 1}-01-01`,
    filed: {
      deductionKind: e.deduction.kind,
      studentLoanInterest: "1",
      educationCredit: "0",
      dependentCareCredit: "0",
    },
    input: asDrafted,
    studentLoanInterestCents: 0,
    tuitionCents: known.tuitionCents,
    careCents: known.careCents,
    children: known.children,
  }).findings;
  const credit = (key: string) => money(credits.find((f) => f.key === key)?.savesCents ?? 0);
  return {
    fields: {
      taxYear: String(known.year),
      filingStatus: i.filingStatus,
      wages: money(known.w2WagesCents ?? i.income.wagesCents),
      interest: money(interest),
      dividends: money(dividends),
      capitalGains: money(gains),
      businessIncome: money(i.income.selfEmploymentCents),
      agi: money(e.agiCents),
      deductionKind: e.deduction.kind,
      deduction: money(
        e.deduction.kind === "itemized" ? e.deduction.itemizedCents : e.deduction.standardCents,
      ),
      studentLoanInterest: money(student),
      educationCredit: credit("education_credit"),
      dependentCareCredit: credit("dependent_care_credit"),
      totalTax: money(e.totalTaxCents),
      federalWithheld: money(withheld),
      estimatedPaid: money(estimated),
      refund: money(withheld + estimated - e.totalTaxCents),
    },
    planted,
  };
}
