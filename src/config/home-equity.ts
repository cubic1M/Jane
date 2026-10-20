// A home's equity, used well (spec step 228): PMI measured against the home's original
// value, escrow checked against the real bills, and the ways to borrow against a home for a
// project. Every rule below names where it comes from; the rates and fees are the stand-in
// lender's, shown labelled, until a real lending partner is connected.

// --- PMI (Homeowners Protection Act, as the CFPB explains it) -------------------------------

// The balance, as a share of the home's ORIGINAL value, at which the person can ask to have
// PMI cancelled (80%) and at which it must end by itself (78%, when payments are current).
// The same numbers as step 115's (src/config/debt.ts), measured against the value the loan
// began with rather than today's.
export { PMI_ASK_LTV, PMI_AUTO_LTV, PMI_SOURCE } from "./debt";
// The conditions for asking, in the CFPB's words, for the drafted request to state.
export const PMI_ASK_CONDITIONS: readonly string[] = [
  "You are current on your payments and have a good payment history.",
  "There is no second mortgage or other lien on the home.",
  "The home hasn't dropped in value below the original value.",
];
// A drafted request is followed up this many days after the person says they sent it.
export const PMI_FOLLOW_UP_DAYS = 30;

// --- Escrow (RESPA, Regulation X section 1024.17) ---------------------------------------------

// The servicer may keep a cushion of up to two months of the bills in escrow.
export const ESCROW_CUSHION_MONTHS = 2;
// A surplus of this much or more is refunded to the borrower within 30 days of the analysis.
export const ESCROW_REFUND_MIN_CENTS = 5_000;
export const ESCROW_SOURCE = "https://www.consumerfinance.gov/rules-policy/regulations/1024/17/";
export const ESCROW_EXPLAINER =
  "https://www.consumerfinance.gov/ask-cfpb/what-is-an-escrow-or-impound-account-en-140/";
// A loan term is read from the bank's description ("Conventional 30 year fixed"); this is used
// when it doesn't say.
export const DEFAULT_TERM_YEARS = 30;

// --- Borrowing against the home for a project ---------------------------------------------------

// Stand-in lender terms (not live quotes). A HELOC's rate is variable; the other two are fixed.
export const PROJECT_PRODUCTS = {
  heloc: {
    label: "Home equity line of credit (HELOC)",
    name: "HELOC",
    aprBps: 850,
    variable: true,
    // Closing costs, flat.
    closingCents: 50_000,
    // The most the home can be borrowed against, loans together, as a share of its value.
    maxCombinedLtv: 0.85,
  },
  cash_out: {
    label: "Cash-out refinance",
    name: "cash-out refinance",
    aprBps: 650,
    variable: false,
    // Closing costs as a share of the new loan.
    closingShare: 0.03,
    termYears: 30,
    maxCombinedLtv: 0.8,
  },
  personal: {
    label: "Personal loan",
    name: "personal loan",
    aprBps: 1150,
    variable: false,
    // An origination fee as a share of the amount.
    feeShare: 0.05,
    maxCents: 10_000_000,
  },
} as const;
export type ProjectProduct = keyof typeof PROJECT_PRODUCTS;
// "How should I pay for a $40,000 kitchen?" with no years given: paid back over this long.
export const PROJECT_YEARS_DEFAULT = 10;
export const PROJECT_YEARS_MAX = 30;
// A project of at least this much (and at most this) is worth a comparison.
export const PROJECT_MIN_CENTS = 100_000;
export const PROJECT_MAX_CENTS = 100_000_000;
// What to keep in mind with each product, shown beside the comparison.
export const PROJECT_NOTES: Readonly<Record<ProjectProduct, string>> = {
  heloc:
    "The rate can change over the years, and the home is the collateral: missing payments can put it at risk.",
  cash_out:
    "It replaces your whole mortgage, so the new rate and the 30-year term apply to the balance you have now too.",
  personal:
    "Nothing is pledged, so the rate is higher and the term shorter; the home is not at risk.",
};
export const HOME_EQUITY_SOURCE =
  "stand-in lender terms in src/config/home-equity.ts, until a real lending partner is connected";
