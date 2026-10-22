// Renting, counted (spec step 248): rent that builds credit, a rent increase set beside what
// is usual, and a security deposit followed to the day it is due back. The stand-ins and the
// state rules live here with where they come from.

// The rent payments in the bank data: a rent category and a landlord-looking name, the same
// rule the profile uses to decide someone rents (src/profile/build.ts).
export const RENT_CATEGORY = "RENT_AND_UTILITIES_RENT";
export const RENT_NAME = /RENT|APARTMENTS|PROPERT/i;
export const RENT_NAME_NOT = /HOME RENT/i;

// How far back rent is read, and how many payments make a pattern.
export const RENT_LOOKBACK_DAYS = 365;
export const RENT_MIN_PAYMENTS = 3;

// The reporting partner stand-in (a credit bureau reporting partner goes here once there is
// one). Reporting is the person's choice: nothing is reported without their opt-in, and it can
// be turned off.
export const RENT_REPORTING = {
  partner: "Rent reporting partner (stand-in)",
  // What partners typically charge each month, shown before the person opts in.
  monthlyFeeCents: 695,
  // Rent history only helps a file when a scoring model counts it; not every lender does.
  note: "Reporting adds your on-time rent to your credit file, which can help a thin file; not every lender or score counts it, and a late payment can hurt.",
} as const;

// What reporting is worth when the person carries a balance: a guessed, small drop in the rate
// they are offered on what they owe, in basis points. Capped as a guess in the detector.
export const RENT_REPORTING_RATE_BENEFIT_BPS = 50;

// A stand-in for what rents usually rise in a year where the person lives (a local rent data
// partner goes here). A rise above the usual by this much is worth asking about.
export const LOCAL_RENT = {
  label: "Stand-in local rent trend",
  usualYearlyRiseBps: 400,
  askAboveBps: 600,
} as const;

// Security deposits: days after moving out that the landlord must return the deposit or send
// an itemised list of deductions. Facts from each state's law, as cited; a lease or a building
// size can change them, so every answer says to confirm.
export type DepositRule = { days: number; note: string; source: string };

export const DEPOSIT_RULES: Readonly<Record<string, DepositRule>> = {
  CA: {
    days: 21,
    note: "Return it or itemise deductions within 21 days.",
    source: "California Civil Code § 1950.5",
  },
  NY: {
    days: 14,
    note: "Return it or itemise deductions within 14 days.",
    source: "New York General Obligations Law § 7-108",
  },
  TX: {
    days: 30,
    note: "Return it or itemise deductions within 30 days of moving out, if you gave a forwarding address.",
    source: "Texas Property Code § 92.103",
  },
  FL: {
    days: 15,
    note: "Return it within 15 days if there is no claim; a claim must be sent within 30 days.",
    source: "Florida Statutes § 83.49",
  },
  MA: {
    days: 30,
    note: "Return it with any deductions itemised within 30 days.",
    source: "Massachusetts General Laws ch. 186 § 15B",
  },
  WA: {
    days: 30,
    note: "Return it or give a written statement of deductions within 30 days.",
    source: "Revised Code of Washington § 59.18.280",
  },
  IL: {
    days: 30,
    note: "In buildings of five or more units, itemise deductions within 30 days and return the rest within 45.",
    source: "Illinois Security Deposit Return Act (765 ILCS 710)",
  },
};
export const DEPOSIT_DEFAULT: DepositRule = {
  days: 30,
  note: "Most states give the landlord 14 to 60 days. This assumes 30; check yours.",
  source: "Your state's landlord-tenant law",
};
export const DEPOSIT_STATES = Object.keys(DEPOSIT_RULES);
export const depositRule = (state: string): DepositRule =>
  DEPOSIT_RULES[state.toUpperCase()] ?? DEPOSIT_DEFAULT;

// A deposit's return is brought up this many days before it is due.
export const DEPOSIT_WARN_DAYS = 7;

export const RENTING_SOURCES = [
  {
    label: "CFPB: rent and your credit",
    url: "https://www.consumerfinance.gov/consumer-tools/credit-reports-and-scores/",
  },
] as const;
