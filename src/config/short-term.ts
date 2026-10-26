import { HIGH_YIELD_SAVINGS_BPS } from "./cash";

// Short-term money, placed safely (spec step 234, demo advice): money needed within three
// years, compared after tax. The rates are stand-ins with their date, until a rates partner is
// connected. FOR REVIEW: ESTIMATE TO VERIFY each against current published rates.

export const SHORT_TERM_RATES_AS_OF = "2026-10-01";
export const SHORT_TERM_RATES_SOURCE =
  "TreasuryDirect auction results, large banks' published CD and savings rates, and the Treasury's I bond rate; ESTIMATE TO VERIFY";

// Money needed within this many months is "short-term".
export const SHORT_TERM_MONTHS = 36;

export type ProductKey =
  "hysa" | "tbill_3" | "tbill_6" | "tbill_12" | "cd_3" | "cd_6" | "cd_12" | "ibond";

export type Product = {
  key: ProductKey;
  name: string;
  rateBps: number;
  // Months the money can't be touched without a cost (0: reachable any day).
  lockMonths: number;
  // Treasury interest (bills, I bonds) is free of state income tax; bank interest isn't.
  stateTaxed: boolean;
  note: string;
};

export const PRODUCTS: readonly Product[] = [
  {
    key: "hysa",
    name: "High-yield savings",
    rateBps: HIGH_YIELD_SAVINGS_BPS,
    lockMonths: 0,
    stateTaxed: true,
    note: "FDIC insured; reach it any day; the rate can change",
  },
  {
    key: "tbill_3",
    name: "3-month Treasury bill",
    rateBps: 405,
    lockMonths: 3,
    stateTaxed: false,
    note: "Backed by the US government; state-tax free",
  },
  {
    key: "tbill_6",
    name: "6-month Treasury bill",
    rateBps: 400,
    lockMonths: 6,
    stateTaxed: false,
    note: "Backed by the US government; state-tax free",
  },
  {
    key: "tbill_12",
    name: "1-year Treasury bill",
    rateBps: 390,
    lockMonths: 12,
    stateTaxed: false,
    note: "Backed by the US government; state-tax free",
  },
  {
    key: "cd_3",
    name: "3-month CD",
    rateBps: 410,
    lockMonths: 3,
    stateTaxed: true,
    note: "FDIC insured; a penalty for early withdrawal",
  },
  {
    key: "cd_6",
    name: "6-month CD",
    rateBps: 420,
    lockMonths: 6,
    stateTaxed: true,
    note: "FDIC insured; a penalty for early withdrawal",
  },
  {
    key: "cd_12",
    name: "1-year CD",
    rateBps: 425,
    lockMonths: 12,
    stateTaxed: true,
    note: "FDIC insured; a penalty for early withdrawal",
  },
  {
    key: "ibond",
    name: "I bond",
    rateBps: 403,
    lockMonths: 12,
    stateTaxed: false,
    note: "Can't be cashed for 12 months; before 5 years it loses the last 3 months of interest; $10,000 a year",
  },
];

// An I bond redeemed before this many months loses this many months of interest.
export const IBOND_PENALTY_BEFORE_MONTHS = 60;
export const IBOND_PENALTY_MONTHS = 3;

// Bill terms a ladder can buy, in months, longest first.
export const BILL_TERMS = [12, 6, 3] as const;
// A ladder has at most this many rungs.
export const MAX_RUNGS = 4;
// The emergency fund's floor stays in high-yield savings: this many months of spending.
export const EMERGENCY_FLOOR_MONTHS = 3;
// Not worth a message below this much extra a year after tax (cents).
export const MIN_GAIN_CENTS = 3_000;
// Without a tax profile: federal rate on the next dollar, and the state's.
export const DEFAULT_FED_RATE = 0.22;
export const DEFAULT_STATE_RATE = 0.05;
