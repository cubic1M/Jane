import {
  ASSET_CLASSES,
  FUND_FACTS,
  mixOfType,
  type AssetClass,
  type AssetMix,
} from "@/config/funds";
import { RETIREMENT_SUBTYPES } from "@/data-sources/types";
import { monthsEnding } from "./spending";
import { dayLabel } from "@/lib/day-label";

// What the person owns in their investment and retirement accounts (spec step 128), from
// the holdings Plaid (or the demo bank) reports. Pure: rows in, the summary out. The total
// is the accounts' balances, exactly as net worth counts them; the holdings are what's
// inside, and an account whose holdings don't add up to its balance says so.

export type InvestmentAccountRow = {
  id: string;
  name: string;
  subtype: string | null;
  balanceCents: number | null;
  // Where the numbers came from: the bank's name, as on the linked item.
  institution: string | null;
};

export type SecurityRow = {
  id: string;
  name: string;
  ticker: string | null;
  type: string | null;
  isCashEquivalent: boolean;
};

export type HoldingRow = {
  id: string;
  accountId: string;
  securityId: string;
  quantity: number;
  priceCents: number;
  priceAsOf: string | null;
  valueCents: number;
  costBasisCents: number | null;
};

export type HoldingView = {
  id: string;
  accountId: string;
  name: string;
  ticker: string | null;
  // Plaid's type, e.g. "mutual fund", "etf", "equity", "cash".
  type: string | null;
  isCash: boolean;
  quantity: number;
  priceCents: number;
  valueCents: number;
  costBasisCents: number | null;
  // Value minus cost basis; null without a cost basis (and for cash).
  gainCents: number | null;
  // What it charges a year, in basis points, when Jane knows (src/config/funds.ts).
  expenseRatioBps: number | null;
  category: string | null;
  mix: AssetMix;
  // Where every number on the row came from, in words.
  source: string;
  factsSource: string | null;
};

export type InvestmentAccountView = {
  id: string;
  name: string;
  kind: "retirement" | "investment";
  // Plaid's subtype in plain words: "401(k)", "Brokerage".
  label: string;
  // Plaid's own subtype, e.g. "401k" (spec step 130: an employer plan's menu applies).
  subtype: string | null;
  balanceCents: number | null;
  holdingsCents: number;
  // Whether the holdings add up to the balance (to the cent).
  holdingsMatch: boolean;
  holdings: HoldingView[];
  institution: string | null;
};

export type InvestmentSummary = {
  // The accounts' balances: the same number as net worth's investments.
  totalCents: number;
  byKind: { retirement: number; investment: number };
  // The holdings' values split into asset classes by what each fund holds.
  byAssetClass: { assetClass: AssetClass; label: string; valueCents: number }[];
  accounts: InvestmentAccountView[];
  holdingCount: number;
};

// Plaid investment subtypes Jane calls something plainer.
const SUBTYPE_LABELS: Readonly<Record<string, string>> = {
  "401k": "401(k)",
  "403b": "403(b)",
  "457b": "457(b)",
  "roth 401k": "Roth 401(k)",
  ira: "IRA",
  roth: "Roth IRA",
  "sep ira": "SEP IRA",
  "simple ira": "SIMPLE IRA",
  hsa: "HSA",
  "529": "529 college savings",
  brokerage: "Brokerage",
  // Spec step 213: a child's accounts.
  custodial: "Custodial (child's)",
  "child roth": "Child's Roth IRA",
  retirement: "Retirement",
};

export const subtypeLabel = (subtype: string | null) =>
  (subtype && SUBTYPE_LABELS[subtype.toLowerCase()]) ?? (subtype ? subtype : "Investment account");

// "Demo Bank (fake data), Demo 401(k), price as of Oct 18, 2026".
export function sourceLine(
  account: { name: string; institution: string | null },
  asOf: string | null,
) {
  const from = account.institution ?? "Your bank";
  return `${from}, ${account.name}${asOf ? `, price as of ${dayLabel(asOf, { year: true })}` : ""}`;
}

export function holdingView(
  holding: HoldingRow,
  security: SecurityRow,
  account: { name: string; institution: string | null },
): HoldingView {
  const facts = security.ticker ? FUND_FACTS[security.ticker.toUpperCase()] : undefined;
  const isCash = security.isCashEquivalent || security.type === "cash";
  return {
    id: holding.id,
    accountId: holding.accountId,
    name: security.name,
    ticker: security.ticker,
    type: security.type,
    isCash,
    quantity: holding.quantity,
    priceCents: holding.priceCents,
    valueCents: holding.valueCents,
    costBasisCents: holding.costBasisCents,
    gainCents:
      holding.costBasisCents === null || isCash
        ? null
        : holding.valueCents - holding.costBasisCents,
    expenseRatioBps: facts?.expenseRatioBps ?? null,
    category: facts?.category ?? null,
    mix: facts?.mix ?? mixOfType(security.type, security.isCashEquivalent),
    source: sourceLine(account, holding.priceAsOf),
    factsSource: facts?.source ?? null,
  };
}

// Retirement accounts by Plaid's subtype; "retirement" is how accounts linked before step
// 128 were saved.
export const isRetirement = (subtype: string | null) =>
  RETIREMENT_SUBTYPES.has((subtype ?? "").toLowerCase());

export function investmentSummary(
  accounts: InvestmentAccountRow[],
  securities: SecurityRow[],
  holdings: HoldingRow[],
): InvestmentSummary {
  const securityById = new Map(securities.map((s) => [s.id, s]));
  const byKind = { retirement: 0, investment: 0 };
  const classes = new Map<AssetClass, number>();
  let total = 0;
  let count = 0;
  const views = accounts.map((account): InvestmentAccountView => {
    const kind = isRetirement(account.subtype) ? "retirement" : "investment";
    if (account.balanceCents !== null) {
      total += account.balanceCents;
      byKind[kind] += account.balanceCents;
    }
    const rows = holdings
      .filter((h) => h.accountId === account.id)
      .flatMap((h) => {
        const security = securityById.get(h.securityId);
        return security ? [holdingView(h, security, account)] : [];
      })
      .sort((a, b) => b.valueCents - a.valueCents || a.name.localeCompare(b.name));
    count += rows.length;
    for (const h of rows) {
      for (const [assetClass, share] of Object.entries(h.mix) as [AssetClass, number][]) {
        classes.set(assetClass, (classes.get(assetClass) ?? 0) + h.valueCents * share);
      }
    }
    const holdingsCents = rows.reduce((sum, h) => sum + h.valueCents, 0);
    return {
      id: account.id,
      name: account.name,
      kind,
      label: subtypeLabel(account.subtype),
      subtype: account.subtype,
      balanceCents: account.balanceCents,
      holdingsCents,
      holdingsMatch: rows.length > 0 && holdingsCents === account.balanceCents,
      holdings: rows,
      institution: account.institution,
    };
  });
  return {
    totalCents: total,
    byKind,
    byAssetClass: (Object.keys(ASSET_CLASSES) as AssetClass[])
      .map((assetClass) => ({
        assetClass,
        label: ASSET_CLASSES[assetClass],
        valueCents: Math.round(classes.get(assetClass) ?? 0),
      }))
      .filter((c) => c.valueCents !== 0),
    accounts: views.sort(
      (a, b) => (b.balanceCents ?? 0) - (a.balanceCents ?? 0) || a.name.localeCompare(b.name),
    ),
    holdingCount: count,
  };
}

// Investment balances at the end of each month, by kind: each account's last snapshot in
// or before that month (as net worth does). Null before any snapshot.
export function monthlyInvestments(
  accounts: Pick<InvestmentAccountRow, "id" | "subtype">[],
  snapshots: { accountId: string; date: string; balanceCents: number }[],
  asOf: string,
  monthCount: number,
): {
  month: string;
  retirementCents: number;
  investmentCents: number;
  totalCents: number | null;
}[] {
  const kindOf = new Map(
    accounts.map((a) => [a.id, isRetirement(a.subtype) ? "retirement" : "investment"]),
  );
  const sorted = snapshots
    .filter((s) => kindOf.has(s.accountId))
    .sort((a, b) => a.date.localeCompare(b.date));
  return monthsEnding(asOf, monthCount).map((month) => {
    const last = new Map<string, number>();
    for (const s of sorted) if (s.date.slice(0, 7) <= month) last.set(s.accountId, s.balanceCents);
    let retirement = 0;
    let investment = 0;
    for (const [accountId, cents] of last) {
      if (kindOf.get(accountId) === "retirement") retirement += cents;
      else investment += cents;
    }
    return {
      month,
      retirementCents: retirement,
      investmentCents: investment,
      totalCents: last.size === 0 ? null : retirement + investment,
    };
  });
}

// "0.75%".
export const formatBps = (bps: number) => `${(bps / 100).toFixed(2)}%`;
