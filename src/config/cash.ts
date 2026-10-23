// Cash done right (spec step 162, demo advice): every dollar of cash where it earns what it
// should, with the emergency fund always in reach. The rates are stand-ins with the date
// they were set, until a rates partner is connected. FOR REVIEW: every rate is ESTIMATE TO
// VERIFY against current published rates before anyone relies on it.

export const CASH_RATES_AS_OF = "2026-10-01";

// What a high-yield savings account pays a year (basis points): the one rate every page,
// finding and suggestion uses for it (docs/feature-audit.md, cluster 13), idle cash included.
export const HIGH_YIELD_SAVINGS_BPS = 400;

// Where cash sits today, by kind of account: what it typically earns a year (basis points).
export const CURRENT_CASH_RATE_BPS = {
  checking: 7,
  savings: 39,
  sweep: 50,
} as const;
export type CashPlaceKind = keyof typeof CURRENT_CASH_RATE_BPS;
export const CURRENT_CASH_RATE_SOURCE =
  "FDIC national rates for checking and savings; typical brokerage cash sweep; ESTIMATE TO VERIFY";

// Where cash could sit: what it earns, how many days to reach it, and whether the
// emergency fund may go there (only when it can be reached in days).
export type CashHome = {
  key: "high_yield_savings" | "money_market" | "treasury_ladder";
  name: string;
  rateBps: number;
  // Business days to have the money in checking.
  reachDays: number;
  // Insured by the FDIC or backed by the US government.
  insured: boolean;
  note: string;
};
export const CASH_HOMES: readonly CashHome[] = [
  {
    key: "high_yield_savings",
    name: "High-yield savings",
    rateBps: HIGH_YIELD_SAVINGS_BPS,
    reachDays: 2,
    insured: true,
    note: "Insured by the FDIC; a transfer back takes a day or two",
  },
  {
    key: "money_market",
    name: "Money market fund",
    rateBps: 420,
    reachDays: 1,
    insured: false,
    note: "Not FDIC insured; sold the next business day",
  },
  {
    key: "treasury_ladder",
    name: "Treasury ladder (3, 6 and 12-month bills)",
    rateBps: 410,
    reachDays: 365,
    insured: true,
    note: "Backed by the US government, no state income tax; each rung is only cash at maturity",
  },
];
export const CASH_HOMES_SOURCE =
  "Published rates of large online banks, money market funds and Treasury bill auctions; ESTIMATE TO VERIFY";

// The emergency fund only goes where it can be reached within this many days.
export const EMERGENCY_MAX_REACH_DAYS = 3;
// Checking keeps this many months of spending, for bills and the month's spending.
export const CHECKING_BUFFER_MONTHS = 1;
// A move smaller than this isn't worth suggesting (cents).
export const CASH_MIN_MOVE_CENTS = 50_000;
// The demo brokerage's money market fund (src/config/funds.ts).
export const MONEY_MARKET_TICKER = "KMMXX";
// Transfers Jane scheduled for cash count as done for this long, since the demo bank's
// balances don't show them.
export const CASH_MOVE_DAYS = 30;
// Jane brings the plan up only when it would earn at least this much more a year (cents).
export const CASH_MIN_GAIN_CENTS = 5_000;
