// Last year's return, reviewed (spec step 172). FOR REVIEW.
//
// A return can be amended (Form 1040-X) within 3 years of filing it, or 2 years of paying
// the tax, whichever is later (IRS: "Amended returns and Form 1040-X"). Jane counts from
// the original filing deadline, April 15 of the year after the tax year.

export const AMEND_WITHIN_YEARS = 3;

// An amended return is only worth preparing when what was missed adds up to at least this.
export const AMEND_MIN_CENTS = 10_000;

// How many past tax years Jane will read a return for.
export const PRIOR_RETURN_YEARS_BACK = 4;

// The fields Jane reads off a return, in order. money fields are dollars as typed; refund
// is signed (negative: the person owed).
export type PriorReturnFieldKey =
  | "taxYear"
  | "filingStatus"
  | "agi"
  | "deductionKind"
  | "deduction"
  | "studentLoanInterest"
  | "educationCredit"
  | "dependentCareCredit"
  | "totalTax"
  | "refund";

export const PRIOR_RETURN_FIELDS: readonly {
  key: PriorReturnFieldKey;
  label: string;
  type: "year" | "choice" | "money" | "signed";
  line: string;
}[] = [
  { key: "taxYear", label: "Tax year", type: "year", line: "top of Form 1040" },
  { key: "filingStatus", label: "Filing status", type: "choice", line: "top of Form 1040" },
  { key: "agi", label: "Adjusted gross income", type: "money", line: "Form 1040 line 11" },
  {
    key: "deductionKind",
    label: "Standard or itemized",
    type: "choice",
    line: "Form 1040 line 12",
  },
  { key: "deduction", label: "Deduction taken", type: "money", line: "Form 1040 line 12" },
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
    key: "refund",
    label: "Refund (negative if you owed)",
    type: "signed",
    line: "Form 1040 lines 34 and 37",
  },
];

export const DEDUCTION_KINDS = { standard: "Standard deduction", itemized: "Itemized" } as const;
