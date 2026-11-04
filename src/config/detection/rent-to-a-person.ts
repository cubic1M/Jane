import type { PfcDetailed } from "@/categorize/taxonomy";
import { NOT_A_REFUND_MIN_CENTS } from "./forecast";

// --- Rent paid to a person ----------------------------------------------------------------------

// Rent sent by Zelle or Venmo to a landlord who is a person reads as a transfer, so it's missing
// from spending, bills and the idle-cash cushion (CSV bench, round 24). Jane asks rather than
// guesses: "Is this your rent?". It asks about about the same amount to the same payee every
// month, near the start of the month, for at least RENT_TRANSFER_MIN_MONTHS months, and at least
// RENT_TRANSFER_MIN_CENTS. A yes files those payments as rent; a no keeps them as transfers, and
// either way Jane never asks about that payee again.
export const RENT_TRANSFER_WORDS: readonly string[] = ["ZELLE", "VENMO", "CASH APP", "PAYPAL"];
// Cash deposits as income (founder, 10-30): Plaid calls cash paid in moved money, so a server
// who lives on tips read as earning half of what they do. Deposits that come back regularly,
// at a similar cadence or of similar amounts, count as income (src/categorize/cash-income.ts).
export const CASH_INCOME_CATEGORIES: readonly PfcDetailed[] = ["TRANSFER_IN_DEPOSIT"];
// At least this many deposits, spread over at least this many days, at least about monthly.
export const CASH_INCOME_MIN_DEPOSITS = 4;
export const CASH_INCOME_MIN_SPAN_DAYS = 28;
export const CASH_INCOME_MAX_MEDIAN_GAP_DAYS = 35;
// Regular: the days between deposits vary by at most this share of their average (weekly tips
// on Mondays and Fridays still pass), or the amounts do.
export const CASH_INCOME_MAX_GAP_CV = 0.6;
export const CASH_INCOME_MAX_AMOUNT_CV = 0.5;
// A deposit more than this many times the usual one is a one-off (a car sold for cash): left out.
export const CASH_INCOME_ONE_OFF_FACTOR = 3;
// Regular money in from one payer, with no pay word in the line (src/categorize/regular-payers.ts).
// Under this it's more likely a share of a bill than pay.
// What the person's own employer pays besides salary, said in the line (debugger 11-03: a $12,000
// "NORTHWIND ROBOTICS BONUS" matched nothing). The employer's name has to match too: "CHECKING BONUS"
// is a bank's offer.
export const EMPLOYER_EXTRA_PAY = /\b(?:BONUS|COMMISSION|INCENTIVE)\b/i;

export const REGULAR_PAYER_MIN_CENTS = 20_000;
// Likely the person's own money moving: a bank, a broker or a payment app.
export const REGULAR_PAYER_NOT_INCOME =
  /\b(?:bank|savings|checking|transfer|credit union|fcu|investments?|brokerage|schwab|fidelity|vanguard|robinhood|coinbase|venmo|paypal|zelle|cash ?app|apple cash)\b/i;

// Also their own money: the same amount left another of their accounts within this many days, on
// at least this share of the deposits.
export const REGULAR_PAYER_OWN_MONEY_DAYS = 3;
export const REGULAR_PAYER_OWN_MONEY_SHARE = 0.5;
// Clients paying at uneven times (src/categorize/regular-payers.ts, clientDeposits). Big deposits with
// no category from payers who come back: at least this much each, at least twice from a payer, and at
// least this many in all across at least this many months, so a relative's two gifts aren't a business.
export const CLIENT_DEPOSIT_MIN_CENTS = NOT_A_REFUND_MIN_CENTS;
export const CLIENT_PAYER_MIN_DEPOSITS = 2;
export const CLIENT_MIN_DEPOSITS = 4;
export const CLIENT_MIN_MONTHS = 3;
// Money in that comes back but isn't a client paying.
export const CLIENT_NOT_INCOME =
  /\b(?:loans?|disbursement|refund|reimburs\w*|claim|escrow|title|estate|irs|treas|tax|insurance|lending|mortgage|rebate|settlement|dividend|interest|visa|mastercard|payment|thank you|roommate|rent)\b/i;
// The word in a line that says one person paid another, by name.
export const REGULAR_PAYER_PERSON_WORD = "zelle";

export const RENT_TRANSFER_MIN_MONTHS = 2;
export const RENT_TRANSFER_MIN_CENTS = 50_000;
// Within this share of the usual amount (a rent can carry a small fee or a utility share).
export const RENT_TRANSFER_AMOUNT_TOLERANCE = 0.05;
// Near the start of the month: from this day of the month before, to this day of the month.
export const RENT_TRANSFER_FROM_DAY = 25;
export const RENT_TRANSFER_TO_DAY = 7;
