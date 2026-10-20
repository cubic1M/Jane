// Out of costly short-term borrowing (spec step 247): payday loans, card cash advances, repeated
// overdrafts and pay advance apps found in the payments, what they cost in a year, and the
// cheaper ways out. Assumptions and rules live here with where they come from.

export type CostlyKind = "payday" | "cash_advance" | "overdraft" | "pay_app";
export const COSTLY_KINDS: readonly CostlyKind[] = [
  "payday",
  "cash_advance",
  "overdraft",
  "pay_app",
];

export const COSTLY_LABELS: Readonly<Record<CostlyKind, string>> = {
  payday: "Payday loans",
  cash_advance: "Card cash advances",
  overdraft: "Overdraft fees",
  pay_app: "Pay advance apps",
};

// Looked at: the last year.
export const COSTLY_LOOKBACK_DAYS = 365;
// What the person's own payments don't say, assumed to turn a fee into a yearly rate. Stated
// next to every rate that uses one.
export const ASSUMED = {
  // An overdraft covers a small amount until the next deposit (the CFPB's own example is a
  // $24 purchase, a $34 fee and a 3-day wait).
  overdraftCents: 2_400,
  overdraftDays: 3,
  // A pay advance app lends a small advance until payday.
  payAppDays: 7,
  payAppCents: 10_000,
  // A cash advance is repaid with the next card payment, about a month on.
  cashAdvanceDays: 30,
  // Card cash advances start charging interest at once, at this rate unless the card's own is known.
  cashAdvanceAprBps: 2_999,
} as const;
// A year's cost under this isn't worth a message.
export const COSTLY_MIN_YEARLY_CENTS = 5_000;
// Two payday loans in this many days is a cycle.
export const COSTLY_CYCLE_DAYS = 120;
// Costly borrowing creeps back when the latest month's cost passes this after a clean spell.
export const COSTLY_CREEP_MIN_CENTS = 1_000;

// Credit union Payday Alternative Loans (NCUA): a loan with a capped rate and fee.
export const PAL = {
  label: "Credit union payday alternative loan (PAL)",
  aprBpsMax: 2_800,
  applicationFeeCentsMax: 2_000,
  minCents: 20_000,
  maxCents: 200_000,
  termMonths: 6,
  source:
    "https://www.ncua.gov/regulation-supervision/letters-credit-unions-other-guidance/payday-alternative-loans-final-rule",
} as const;

// A pay advance from an employer: ask HR or payroll; many offer one free or at a small fee.
export const EMPLOYER_ADVANCE = {
  label: "Employer pay advance",
  note: "Ask payroll or HR. Many employers offer an advance on your next paycheck for free or a small fee, and it comes out of that paycheck with no interest.",
} as const;

// A buffer built over this many months from what's spare, to cover the gap borrowing fills.
export const BUFFER_MONTHS = 6;
export const BUFFER_DEFAULT_CENTS = 50_000;

export const STOP_CYCLE_STEPS: readonly string[] = [
  "Don't roll a payday loan over or take a new one to pay the last. Each renewal repeats the fee.",
  "Before the due date, ask the lender for an extended payment plan. Many lenders offer one, and some states require it.",
  "Switch off overdraft coverage on your debit card and ATM withdrawals (it's opt-in), so a purchase is declined instead of costing a fee.",
  "Put a low-balance alert on checking, so you move money before it runs out.",
  "Build a small buffer, so the next gap before payday doesn't need a loan.",
];

export const COSTLY_SOURCES = [
  {
    label: "CFPB: what is a payday loan?",
    url: "https://www.consumerfinance.gov/ask-cfpb/what-is-a-payday-loan-en-1567/",
  },
  {
    label: "CFPB: overdraft and your bank account",
    url: "https://www.consumerfinance.gov/consumer-tools/bank-accounts/overdraft/",
  },
] as const;
