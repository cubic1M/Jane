// When income stops (spec step 204): what Jane's lean plan lists. Its hardship options are the
// one catalog in ./debt-trouble.ts.

// Spending categories (Plaid primary) whose bills can wait or be paused when money is short.
export const LEAN_WAITABLE_PRIMARIES: readonly string[] = [
  "ENTERTAINMENT",
  "PERSONAL_CARE",
  "GENERAL_SERVICES",
  "GENERAL_MERCHANDISE",
];
// Recurring charges looked at, next this many days.
export const LEAN_BILL_DAYS = 30;
// At most this many bills named in the message.
export const LEAN_MAX_WAITABLE = 6;

// The unemployment guide, the same steps in every state with the state named; the federal
// directory finds the state's own office.
export const UNEMPLOYMENT_STEPS = [
  "File a claim the first week you're out of work; benefits generally start from the day you file.",
  "Have ready: your Social Security number, the last 18 months of employers, and your last day.",
  "Keep looking for work and log it: most states ask you to report weekly.",
] as const;
export const UNEMPLOYMENT_DIRECTORY =
  "https://www.careeronestop.org/LocalHelp/UnemploymentBenefits/find-unemployment-benefits.aspx";
