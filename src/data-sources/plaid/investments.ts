import type { Holding, InvestmentTransaction, Security } from "plaid";
import { toCents } from "./plaid-source";

// Plaid Investments (spec step 128) in the app's shapes: securities, holdings and
// investment transactions, with dollars turned into cents. Pure. Plaid's own ids are kept
// so each sync replaces what the last one saved.

export type NormalizedSecurity = {
  ref: string;
  name: string;
  ticker: string | null;
  type: string | null;
  subtype: string | null;
  isCashEquivalent: boolean;
  closePriceCents: number | null;
  closePriceAsOf: string | null;
  sector: string | null;
};

export type NormalizedHolding = {
  accountRef: string;
  securityRef: string;
  quantity: number;
  priceCents: number;
  priceAsOf: string | null;
  valueCents: number;
  costBasisCents: number | null;
};

export type NormalizedInvestmentTransaction = {
  ref: string;
  accountRef: string;
  securityRef: string | null;
  date: string;
  name: string;
  quantity: number;
  amountCents: number;
  priceCents: number;
  feesCents: number | null;
  type: string;
  subtype: string;
};

const inDollars = (x: {
  iso_currency_code?: string | null;
  unofficial_currency_code?: string | null;
}) => (x.iso_currency_code ? x.iso_currency_code === "USD" : !x.unofficial_currency_code);

const day = (value: string | null | undefined) =>
  value && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;

// A security with no name gets its ticker, or Plaid's own words for its type.
export function normalizeSecurity(s: Security): NormalizedSecurity {
  return {
    ref: s.security_id,
    name: s.name?.trim() || s.ticker_symbol || (s.type === "cash" ? "Cash" : "Unnamed security"),
    ticker: s.ticker_symbol ?? null,
    type: s.type ?? null,
    subtype: s.subtype ?? null,
    isCashEquivalent: s.is_cash_equivalent ?? false,
    // Dollars only, like holdings: a price in another currency is no figure in cents.
    closePriceCents: inDollars(s) ? toCents(s.close_price) : null,
    closePriceAsOf: day(s.close_price_as_of),
    sector: s.sector ?? null,
  };
}

// Only USD holdings: money in the app is dollars. Others are left out (and so don't add up
// to the account's balance, which the page says).
export function normalizeHolding(h: Holding): NormalizedHolding | null {
  if (!inDollars(h)) return null;
  // Plaid's types say price and value are always there; if one is missing, the other and the
  // share count give it, and if neither can, the holding is left out rather than counted at $0
  // (CodeRabbit sweep).
  let price = toCents(h.institution_price);
  let value = toCents(h.institution_value);
  if (value === null && price !== null) value = Math.round(h.quantity * price);
  if (price === null && value !== null && h.quantity > 0) price = Math.round(value / h.quantity);
  if (value === null) return null;
  return {
    accountRef: h.account_id,
    securityRef: h.security_id,
    quantity: h.quantity,
    priceCents: price ?? 0,
    priceAsOf: day(h.institution_price_as_of ?? h.institution_price_datetime),
    valueCents: value,
    costBasisCents: toCents(h.cost_basis),
  };
}

export function normalizeInvestmentTransaction(
  t: InvestmentTransaction,
): NormalizedInvestmentTransaction | null {
  if (!inDollars(t)) return null;
  // An amount Plaid did not send is unknown, not $0: the transaction is left out.
  const amountCents = toCents(t.amount);
  if (amountCents === null) return null;
  return {
    ref: t.investment_transaction_id,
    accountRef: t.account_id,
    securityRef: t.security_id ?? null,
    date: t.date,
    // The columns are not nullable: a field Plaid leaves null gets a plain value.
    name: t.name ?? "",
    quantity: t.quantity ?? 0,
    amountCents,
    priceCents: toCents(t.price) ?? 0,
    feesCents: toCents(t.fees),
    type: t.type ?? "",
    subtype: t.subtype ?? "",
  };
}
