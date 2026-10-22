import type { LoanProduct } from "@/config/debt";

// The perfect fit for borrowing (spec step 274): every threshold the fit engine
// (src/planning/fit.ts) uses, with where it comes from. Nothing is inline in the planner.

export const FIT_NEEDS = ["car", "home", "refinance", "consolidation", "personal"] as const;
export type FitNeed = (typeof FIT_NEEDS)[number];

export const FIT_NEED_LABELS: Readonly<Record<FitNeed, string>> = {
  car: "a car loan",
  home: "a mortgage",
  refinance: "a refinance",
  consolidation: "consolidating your debt",
  personal: "a personal loan",
};

// The loan product a need is priced as (a refinance takes the product of the debt itself).
export const FIT_PRODUCT: Readonly<Record<Exclude<FitNeed, "refinance">, LoanProduct>> = {
  car: "auto",
  home: "mortgage",
  consolidation: "personal",
  personal: "personal",
};

// The terms (months) the engine asks the lender for, so a shorter term, the usual term and a
// longer one can be set side by side.
export const FIT_TERMS: Readonly<Record<LoanProduct, readonly number[]>> = {
  auto: [36, 48, 60, 72],
  mortgage: [180, 240, 360],
  personal: [24, 36, 48, 60],
  student: [60, 120, 180, 240],
};

// The lowest credit score lenders usually price a loan for. A guide to eligibility, not a
// promise of approval: the lender decides.
export const FIT_CREDIT_FLOOR: Readonly<Record<LoanProduct, number>> = {
  mortgage: 620,
  auto: 560,
  personal: 600,
  student: 580,
};
// Used when there is no pulled score yet: the stand-in band the lenders price by.
export const FIT_ASSUMED_SCORE = 700;

// The most of gross income that all debt payments, the new one included, may take. Mortgage
// lenders' usual back-end limit is 43% (CFPB); auto and personal lenders are looser.
export const FIT_DTI_CEILING: Readonly<Record<LoanProduct, number>> = {
  mortgage: 0.43,
  auto: 0.5,
  personal: 0.45,
  student: 0.5,
};
// Take-home pay is turned into gross with the same stated assumption as buying a home.
export const FIT_NET_TO_GROSS = 0.78;

// The payment on the new loan as a share of take-home that stays comfortable.
export const FIT_COMFORT_SHARE: Readonly<Record<LoanProduct, number>> = {
  auto: 0.12,
  mortgage: 0.3,
  personal: 0.1,
  student: 0.1,
};
// Someone in debt trouble gets this fraction of it: never steered to a bigger payment.
export const FIT_TROUBLE_COMFORT_FACTOR = 0.6;

// A saving smaller than this isn't worth moving for (a refinance or a consolidation).
export const FIT_MIN_SAVING_CENTS = 30_000;

// A debt whose payment barely covers its interest is compared over this many months at most.
export const FIT_BASELINE_MAX_MONTHS = 120;

// Cash kept back when working out whether cash can pay a debt off: this many months of spending.
export const FIT_KEEP_CASH_MONTHS = 1;

export const FIT_MIN_OPTIONS = 2;
export const FIT_MAX_OPTIONS = 4;

// What the engine can't see, as a confidence the pick is capped at, with the reason.
export const FIT_OFFER_EVIDENCE = {
  percent: 75,
  reason: "the offers are stand-in quotes, not a lender's",
} as const;
export const FIT_NO_SCORE_EVIDENCE = {
  percent: 65,
  reason: "I haven't pulled your credit score yet",
} as const;

export const FIT_SOURCES = [
  {
    label: "CFPB: what is a debt-to-income ratio",
    url: "https://www.consumerfinance.gov/ask-cfpb/what-is-a-debt-to-income-ratio-why-is-the-43-debt-to-income-ratio-important-en-1791/",
  },
] as const;

// Consolidating cards into one loan is only worth bringing up when the cards owe at least this
// much, at a weighted rate of at least this, so a small or cheap balance isn't nagged about.
export const FIT_CONSOLIDATION_MIN_CENTS = 150_000;
export const FIT_CONSOLIDATION_MIN_APR_BPS = 1_600;
// The monthly payment on cards when none is seen in the payments: this share of what is owed.
export const FIT_CARD_PAYMENT_SHARE = 0.03;

// What to price when someone asks for the best loan without an amount (said in the answer).
export const FIT_DEFAULT_AMOUNT_CENTS: Readonly<Record<FitNeed, number>> = {
  car: 2_000_000,
  home: 25_000_000,
  refinance: 0,
  consolidation: 0,
  personal: 500_000,
};
