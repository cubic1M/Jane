import { HIGH_YIELD_SAVINGS_BPS } from "../cash";
import type { PfcDetailed, PfcPrimary } from "@/categorize/taxonomy";

// --- Idle cash ---------------------------------------------------------------------

// Plaid depository subtypes whose balance can count as idle cash.
export const IDLE_CASH_SUBTYPES: readonly string[] = ["checking", "savings"];
// Keep this many months of average spending as a cushion; only cash above it is idle.
export const IDLE_CASH_MONTHS_OF_SPENDING = 3;
// Ignore excess cash below this (in cents): the yearly difference would be pocket change.
export const IDLE_CASH_MIN_EXCESS_CENTS = 100_000;
// Yearly rates in basis points (100 = 1%): the high-yield savings rate the cash page shows
// (src/config/cash.ts, one rate everywhere) and a generous guess at what the money earns today.
// Review against current published savings rates before the beta.
export const REFERENCE_HIGH_YIELD_RATE_BPS = HIGH_YIELD_SAVINGS_BPS;
export const ASSUMED_CURRENT_RATE_BPS = 50;
// Spending history needed for medium and high confidence in the monthly average.
export const IDLE_CASH_MEDIUM_CONFIDENCE_MONTHS = 3;
export const IDLE_CASH_HIGH_CONFIDENCE_MONTHS = 6;
// Outflows that move money rather than spend it, left out of average monthly spending.
// A tax payment this many days either side of an IRS estimated-payment date is an estimated
// payment: idle cash holds the same back for each date still to come inside its cushion months
// (debugger 10-30: a freelancer's $1,884 "idle" with the Jan 15 payment of $3,800 to make).
export const IDLE_CASH_TAX_DATE_DAYS = 10;
// ...and it's an estimated payment only when its words say so, or the same payee paid near two
// estimated dates: a county property tax due Apr 10 isn't one (review 10-30).
export const IDLE_CASH_ESTIMATED_TAX_WORDS =
  /USATAXPYMT|ESTIMATED|\bEST\.? ?TAX\b|\bES ?PMTS?\b|1040-?ES|EXPMTS?\b|ESTPMT/i;
// A charge seen once in the past year in these categories (or with annual-fee words) is a yearly
// bill: idle cash holds it back when its anniversary falls inside the cushion months (manager
// 10-30: count dated obligations before calling cash idle). A one-off purchase never qualifies.
export const IDLE_CASH_YEARLY_CATEGORIES: readonly string[] = [
  "GENERAL_SERVICES_INSURANCE",
  "GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT",
];
export const NON_SPENDING_PRIMARIES: readonly PfcPrimary[] = [
  "TRANSFER_OUT",
  "TRANSFER_IN",
  "LOAN_DISBURSEMENTS",
];
export const NON_SPENDING_CATEGORIES: readonly PfcDetailed[] = [
  // Card purchases are already counted on the card itself.
  "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
];
