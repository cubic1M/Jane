import type { LoanProduct } from "@/config/debt";

// What you could borrow (spec step 250): a standing answer to "what could I get, and at what
// rate?", kept current from the score (step 116), income and debts. The eligibility limits are
// the fit engine's (src/config/fit.ts), so the amount here is one the loan options card would
// also call comfortable. What is only a guess lives here, with where it comes from.

export const BORROW_PRODUCTS = ["mortgage", "auto", "personal", "card"] as const;
export type BorrowProduct = (typeof BORROW_PRODUCTS)[number];

export const BORROW_LABELS: Readonly<Record<BorrowProduct, string>> = {
  mortgage: "A mortgage",
  auto: "A car loan",
  personal: "A personal loan",
  card: "A credit card",
};

// The term each loan is priced over: the usual one.
export const BORROW_TERM_MONTHS: Readonly<Record<Exclude<BorrowProduct, "card">, number>> = {
  mortgage: 360,
  auto: 60,
  personal: 36,
};

// The product the lender partner prices each as.
export const BORROW_LOAN_PRODUCT: Readonly<Record<Exclude<BorrowProduct, "card">, LoanProduct>> = {
  mortgage: "mortgage",
  auto: "auto",
  personal: "personal",
};

// The amount the lender is first asked about, to read its rate; the amount Jane shows is then
// worked out from the payment that fits and priced again.
export const BORROW_PROBE_CENTS: Readonly<Record<Exclude<BorrowProduct, "card">, number>> = {
  mortgage: 25_000_000,
  auto: 2_000_000,
  personal: 500_000,
};

// Amounts are estimates, so they're shown rounded down to this.
export const BORROW_ROUND_CENTS: Readonly<Record<Exclude<BorrowProduct, "card">, number>> = {
  mortgage: 100_000,
  auto: 10_000,
  personal: 10_000,
};

// Lenders cap amounts: past a cap no one quotes, so the amount steps down by this share until
// one does, at most this many times.
export const BORROW_STEP_DOWN = 0.85;
export const BORROW_STEP_TRIES = 12;

// A card's limit is set by the issuer; as a stated guess, this share of yearly gross income by
// credit band (issuers commonly start new cards at 10% to 20% of income, less for a thin file).
export const CARD_LIMIT_SHARE: Readonly<Record<"excellent" | "good" | "fair", number>> = {
  excellent: 0.2,
  good: 0.12,
  fair: 0.05,
};
// The amount asked about when reading a card's rate from the stand-in.
export const CARD_PROBE_CENTS = 300_000;

// Checked again once this many days have passed (Jane's monthly run), or when the page opens
// without a check.
export const BORROW_CHECK_DAYS = 30;

// "What would help": each $100 a month less in other debt payments, priced at the same rate.
export const BORROW_HELP_PAYMENT_CENTS = 10_000;

// A change worth a message: the amount up by this share, or the rate down this much.
export const BORROW_MOVE_SHARE = 0.1;
export const BORROW_MOVE_BPS = 25;

// The detector (src/detectors/borrowing-power.ts): someone renting on a wage or uneven pay, not in
// debt trouble, with cash for at least this share of the home they could buy as a down
// payment, is brought what a mortgage would look like; and what comparing lenders is worth: the
// gap between the dearest and the cheapest stand-in rate on that amount, a year.
export const BORROW_DETECT_DOWN_SHARE = 0.035;
// The cash has to cover that down payment on at least this share of the mortgage that fits, so
// the suggestion doesn't flicker on and off as a month's pay moves the amount a little.
export const BORROW_DETECT_COVER_SHARE = 0.5;
// Uneven pay: lenders usually want two years of tax returns, so the amount is less sure.
export const BORROW_UNEVEN_EVIDENCE = {
  percent: 60,
  reason: "lenders want two years of tax returns for uneven pay",
} as const;

export const BORROW_SOURCES = [
  {
    label: "CFPB: what is a debt-to-income ratio",
    url: "https://www.consumerfinance.gov/ask-cfpb/what-is-a-debt-to-income-ratio-why-is-the-43-debt-to-income-ratio-important-en-1791/",
  },
  {
    label: "CFPB: what's the difference between a prequalification and a preapproval",
    url: "https://www.consumerfinance.gov/ask-cfpb/whats-the-difference-between-a-prequalification-letter-and-a-preapproval-letter-en-127/",
  },
] as const;
