import type { SnaptradeAccount, SnaptradePosition, SnaptradePositions } from "./api";

// SnapTrade's accounts and positions in the shape Plaid Investments gives Jane (accounts of type
// "investment"; securities with Plaid's type and subtype; holdings with quantity, price, value and
// total cost basis in cents), so the investing pages and detectors read them unchanged. Securities
// carry a "snaptrade:" ref, by ticker, so the same fund in two accounts is one security.
//
// Left out, and counted: positions in another currency than USD, and derivatives (options, futures,
// CFDs, tokenized assets), whose value depends on a contract size Jane doesn't read. The account's
// total still comes from SnapTrade's net value. Paper (practice) and closed accounts are left out.

export const SNAPTRADE_REF = "snaptrade:";

// SnapTrade's instrument kinds as Plaid's security type and subtype (Plaid's /investments/holdings/get
// security object).
const KINDS: Readonly<Record<string, { type: string; subtype: string }>> = {
  stock: { type: "equity", subtype: "common stock" },
  preferred_stock: { type: "equity", subtype: "preferred equity" },
  adr: { type: "equity", subtype: "depositary receipt" },
  etf: { type: "etf", subtype: "etf" },
  mutualfund: { type: "mutual fund", subtype: "mutual fund" },
  cef: { type: "other", subtype: "other" },
  bond: { type: "fixed income", subtype: "bond" },
  crypto: { type: "cryptocurrency", subtype: "cryptocurrency" },
  other: { type: "other", subtype: "other" },
};

export type SnaptradeHolding = {
  ref: string;
  name: string;
  ticker: string | null;
  type: string;
  subtype: string;
  isCashEquivalent: boolean;
  quantity: number;
  priceCents: number;
  valueCents: number;
  costBasisCents: number | null;
};

export type SnaptradeRead = {
  externalId: string;
  account: {
    name: string;
    mask: string | null;
    type: "investment";
    subtype: string;
    currentBalanceCents: number | null;
  };
  holdings: SnaptradeHolding[];
  leftOut: number;
  // YYYY-MM-DD the brokerage's figures are from.
  asOf: string | null;
};

const decimal = (value: string | null | undefined): number | null => {
  if (typeof value !== "string" || !/^-?\d+(\.\d+)?$/.test(value.trim())) return null;
  return Number(value);
};
const cents = (dollars: number) => Math.round(dollars * 100);

// Its kind from the brokerage's own words, as Plaid's investment subtypes.
function subtypeOf(rawType: string | null | undefined): string {
  const words = (rawType ?? "").toLowerCase();
  if (/\broth\b/.test(words)) return "roth";
  if (/\b401\s?k\b/.test(words)) return "401k";
  if (/\bhsa\b/.test(words)) return "hsa";
  if (/\bira\b|\btraditional\b|\brollover\b/.test(words)) return "ira";
  return "brokerage";
}

function holdingOf(position: SnaptradePosition): SnaptradeHolding | null {
  const kind = KINDS[position.instrument?.kind ?? ""];
  const currency = position.currency ?? position.instrument?.currency ?? "USD";
  const units = decimal(position.units);
  const price = decimal(position.price);
  const ticker = position.instrument?.symbol?.trim() || null;
  if (!kind || currency !== "USD" || units === null || price === null || !ticker) return null;
  const basis = decimal(position.cost_basis);
  return {
    ref: `${SNAPTRADE_REF}${ticker}`,
    name: position.instrument.description?.trim() || ticker,
    ticker,
    ...kind,
    isCashEquivalent: position.cash_equivalent === true,
    quantity: units,
    priceCents: cents(price),
    valueCents: cents(units * price),
    // SnapTrade's is per share; Plaid's (and Jane's) is the position's total.
    costBasisCents: basis === null ? null : cents(basis * units),
  };
}

export function snaptradeRead(
  account: SnaptradeAccount,
  positions: SnaptradePositions,
): SnaptradeRead {
  const holdings: SnaptradeHolding[] = [];
  let leftOut = 0;
  for (const position of positions.results) {
    const holding = holdingOf(position);
    if (!holding) {
      leftOut += 1;
      continue;
    }
    // One holding per security in an account: two lines under one ticker (two lots, or two
    // listings the symbol cannot tell apart) are added together, never one over the other.
    const same = holdings.find((h) => h.ref === holding.ref);
    if (!same) {
      holdings.push(holding);
      continue;
    }
    same.quantity += holding.quantity;
    same.valueCents += holding.valueCents;
    same.costBasisCents =
      same.costBasisCents === null || holding.costBasisCents === null
        ? null
        : same.costBasisCents + holding.costBasisCents;
    same.priceCents =
      same.quantity > 0 ? Math.round(same.valueCents / same.quantity) : same.priceCents;
  }
  const net = account.net_value;
  const mask = (account.masked_account_number ?? "").replace(/\D/g, "").slice(-4);
  const asOf = positions.data_freshness?.as_of ?? null;
  return {
    externalId: account.id,
    account: {
      name: account.display_name?.trim() || "Brokerage account",
      mask: mask || null,
      type: "investment",
      subtype: subtypeOf(account.raw_type),
      currentBalanceCents:
        typeof net?.amount === "number" && (net.currency ?? "USD") === "USD"
          ? cents(net.amount)
          : null,
    },
    holdings,
    leftOut,
    asOf: asOf && /^\d{4}-\d{2}-\d{2}/.test(asOf) ? asOf.slice(0, 10) : null,
  };
}

// The accounts Jane reads: open, real (not paper) investment accounts. SnapTrade leaves out
// "unavailable" ones itself.
export const readable = (account: SnaptradeAccount) =>
  account.kind === "investment" &&
  account.status !== "closed" &&
  account.status !== "archived" &&
  account.is_paper !== true;
