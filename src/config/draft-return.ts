// The return, checked before you file (spec step 272). FOR REVIEW.
//
// A draft return (a PDF from tax software or an accountant) is read line by line, confirmed by
// the person, and checked against what Jane knows for the year: the forms she collected (step
// 166), the accounts, and the estimate (step 120). Line numbers are Form 1040 and Schedule 1
// for tax year 2025 and on (IRS, "Form 1040 instructions"). ESTIMATE TO VERIFY each year.

export type DraftFieldKey =
  | "taxYear"
  | "filingStatus"
  | "wages"
  | "interest"
  | "dividends"
  | "capitalGains"
  | "businessIncome"
  | "agi"
  | "deductionKind"
  | "deduction"
  | "studentLoanInterest"
  | "educationCredit"
  | "dependentCareCredit"
  | "totalTax"
  | "federalWithheld"
  | "estimatedPaid"
  | "refund";

export const DRAFT_FIELDS: readonly {
  key: DraftFieldKey;
  label: string;
  type: "year" | "choice" | "money" | "signed";
  line: string;
}[] = [
  { key: "taxYear", label: "Tax year", type: "year", line: "top of Form 1040" },
  { key: "filingStatus", label: "Filing status", type: "choice", line: "top of Form 1040" },
  { key: "wages", label: "Wages", type: "money", line: "Form 1040 line 1a" },
  { key: "interest", label: "Taxable interest", type: "money", line: "Form 1040 line 2b" },
  { key: "dividends", label: "Ordinary dividends", type: "money", line: "Form 1040 line 3b" },
  { key: "capitalGains", label: "Capital gain or loss", type: "signed", line: "Form 1040 line 7" },
  {
    key: "businessIncome",
    label: "Business income",
    type: "signed",
    line: "Schedule 1 line 3 (Schedule C)",
  },
  { key: "agi", label: "Adjusted gross income", type: "money", line: "Form 1040 line 11" },
  {
    key: "deductionKind",
    label: "Standard or itemized",
    type: "choice",
    line: "Form 1040 line 12",
  },
  { key: "deduction", label: "Deduction", type: "money", line: "Form 1040 line 12" },
  {
    key: "studentLoanInterest",
    label: "Student loan interest deduction",
    type: "money",
    line: "Schedule 1 line 21",
  },
  { key: "educationCredit", label: "Education credit", type: "money", line: "Form 8863" },
  {
    key: "dependentCareCredit",
    label: "Child and dependent care credit",
    type: "money",
    line: "Form 2441",
  },
  { key: "totalTax", label: "Total tax", type: "money", line: "Form 1040 line 24" },
  {
    key: "federalWithheld",
    label: "Federal tax withheld",
    type: "money",
    line: "Form 1040 line 25d",
  },
  {
    key: "estimatedPaid",
    label: "Estimated tax payments",
    type: "money",
    line: "Form 1040 line 26",
  },
  {
    key: "refund",
    label: "Refund (negative if you owe)",
    type: "signed",
    line: "Form 1040 lines 34 and 37",
  },
];

// A figure counts as different from what Jane knows when it's off by more than this much and
// this share (rounding on a return is to whole dollars).
export const DRAFT_TOLERANCE = { cents: 100, share: 0.01 } as const;

// A finding worth a card: at least this much tax either way.
export const DRAFT_MIN_FINDING_CENTS = 2_500;

// The demo draft (the stand-in reader for demo-bank people, src/lib/draft-return/demo.ts): what
// its planted withholding mistake is off by, two digits swapped in the thousands.
export const DEMO_WITHHOLDING_SLIP_CENTS = 100_000;
