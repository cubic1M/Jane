// When income stops (spec step 204): what Jane's lean plan lists. The hardship catalog is a
// stand-in: what lenders in each kind of debt commonly offer, said as questions to ask. A
// real catalog (per lender) replaces it when a partner is connected.

// Spending categories (Plaid primary) whose bills can wait or be paused when money is short.
export const LEAN_WAITABLE_PRIMARIES: readonly string[] = [
  "ENTERTAINMENT",
  "PERSONAL_CARE",
  "GENERAL_SERVICES",
  "GENERAL_MERCHANDISE",
];
// Never listed as able to wait.
export const LEAN_ESSENTIAL_PRIMARIES: readonly string[] = [
  "RENT_AND_UTILITIES",
  "LOAN_PAYMENTS",
  "MEDICAL",
  "TRANSPORTATION",
  "FOOD_AND_DRINK",
];
// Recurring charges looked at, next this many days.
export const LEAN_BILL_DAYS = 30;
// At most this many bills named in the message.
export const LEAN_MAX_WAITABLE = 6;

export const HARDSHIP_PROGRAMS: Readonly<Record<string, { name: string; ask: string }>> = {
  credit: {
    name: "Card hardship program",
    ask: "Ask for a hardship plan: a lower rate or a paused or reduced payment for a few months, and no late fee while it's in place.",
  },
  mortgage: {
    name: "Mortgage forbearance",
    ask: "Ask your servicer about forbearance or a repayment plan before a payment is missed; call as soon as you know.",
  },
  student: {
    name: "Student loan deferment or income-driven plan",
    ask: "Ask about an unemployment deferment or an income-driven plan, which can set the payment near zero.",
  },
  loan: {
    name: "Loan hardship options",
    ask: "Ask about a deferred payment or a lower payment for a few months; it is easier to ask before a payment is missed.",
  },
  auto: {
    name: "Auto loan hardship options",
    ask: "Ask about a payment deferral or an extended term; call before a payment is missed.",
  },
};
export const HARDSHIP_DEFAULT = HARDSHIP_PROGRAMS.loan;

// The unemployment guide, the same steps in every state with the state named; the federal
// directory finds the state's own office.
export const UNEMPLOYMENT_STEPS = [
  "File a claim the first week you're out of work; benefits generally start from the day you file.",
  "Have ready: your Social Security number, the last 18 months of employers, and your last day.",
  "Keep looking for work and log it: most states ask you to report weekly.",
] as const;
export const UNEMPLOYMENT_DIRECTORY =
  "https://www.careeronestop.org/LocalHelp/UnemploymentBenefits/find-unemployment-benefits.aspx";
