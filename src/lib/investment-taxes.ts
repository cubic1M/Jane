import { TAXABLE_INVESTMENT_SUBTYPES } from "@/config/tax";
import { WASH_SALE_DAYS } from "@/config/tax-rates";
import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import {
  harvestChances,
  locationHints,
  lotsFor,
  realised,
  unrealised,
  type HarvestChance,
  type InvHolding,
  type InvTransaction,
  type Realised,
  type Unrealised,
} from "@/planning/investment-taxes";

// Investment taxes (spec step 124), from what's in the person's taxable investment accounts
// (step 128's holdings and investment transactions). Retirement and health accounts aren't
// taxed on gains; their buys still count for the wash-sale rule.

type Options = { client?: PrismaClient; now?: Date };

export type InvestmentTaxesView = {
  year: number;
  taxableAccounts: number;
  unrealised: Unrealised[];
  unrealisedCents: { total: number; shortTerm: number; longTerm: number };
  // Sales in the year.
  realised: Realised[];
  realisedCents: { shortTerm: number; longTerm: number };
  // Loss sales in the last WASH_SALE_DAYS with replacement purchases.
  washSales: Realised[];
  harvest: HarvestChance[];
  location: InvHolding[];
  // Sales of positions no longer held: their cost basis is unknown.
  soldOutSales: number;
};

const iso = (d: Date) => d.toISOString().slice(0, 10);
const DAY_MS = 86_400_000;

export async function loadInvestmentTaxes(
  userId: string,
  year: number,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<InvestmentTaxesView> {
  const db = scopedFor(userId, client);
  const today = iso(now);
  const accounts = await db.accounts.findMany({
    where: { type: "investment" },
    select: { id: true, subtype: true },
  });
  const taxable = new Set(
    accounts.filter((a) => TAXABLE_INVESTMENT_SUBTYPES.includes(a.subtype ?? "")).map((a) => a.id),
  );
  const empty: InvestmentTaxesView = {
    year,
    taxableAccounts: taxable.size,
    unrealised: [],
    unrealisedCents: { total: 0, shortTerm: 0, longTerm: 0 },
    realised: [],
    realisedCents: { shortTerm: 0, longTerm: 0 },
    washSales: [],
    harvest: [],
    location: [],
    soldOutSales: 0,
  };
  if (taxable.size === 0) return empty;
  const [holdings, transactions] = await Promise.all([
    db.holdings.findMany({
      where: { accountId: { in: [...taxable] } },
      select: {
        accountId: true,
        securityId: true,
        quantity: true,
        valueCents: true,
        costBasisCents: true,
        security: { select: { ticker: true, name: true, type: true, isCashEquivalent: true } },
      },
    }),
    db.investmentTransactions.findMany({
      where: { type: { in: ["buy", "sell"] } },
      select: {
        accountId: true,
        securityId: true,
        date: true,
        type: true,
        subtype: true,
        quantity: true,
        amountCents: true,
      },
    }),
  ]);
  const txs: InvTransaction[] = transactions.map((t) => ({ ...t, date: iso(t.date) }));
  const held: InvHolding[] = holdings
    .filter((h) => !h.security.isCashEquivalent && h.security.type !== "cash")
    .map((h) => ({
      accountId: h.accountId,
      securityId: h.securityId,
      ticker: h.security.ticker,
      name: h.security.name,
      type: h.security.type,
      quantity: h.quantity,
      valueCents: h.valueCents,
      costBasisCents: h.costBasisCents,
    }));
  const allUnrealised: Unrealised[] = [];
  const allRealised: Realised[] = [];
  for (const h of held) {
    const own = txs.filter((t) => t.accountId === h.accountId && t.securityId === h.securityId);
    const { left, sales } = lotsFor(h.quantity, own);
    const u = unrealised(h, left, today);
    if (u) allUnrealised.push(u);
    allRealised.push(...realised(h, sales, txs));
  }
  const heldKeys = new Set(held.map((h) => `${h.accountId}:${h.securityId}`));
  const soldOut = txs.filter(
    (t) =>
      t.type === "sell" &&
      taxable.has(t.accountId) &&
      t.date.startsWith(String(year)) &&
      !heldKeys.has(`${t.accountId}:${t.securityId}`),
  ).length;
  const inYear = allRealised.filter((r) => r.date.startsWith(String(year)));
  const since = iso(new Date(now.getTime() - (WASH_SALE_DAYS + 31) * DAY_MS));
  return {
    ...empty,
    unrealised: allUnrealised,
    unrealisedCents: {
      total: allUnrealised.reduce((s, u) => s + u.gainCents, 0),
      shortTerm: allUnrealised.reduce((s, u) => s + u.shortTermCents, 0),
      longTerm: allUnrealised.reduce((s, u) => s + u.longTermCents, 0),
    },
    realised: inYear,
    realisedCents: {
      shortTerm: inYear.reduce((s, r) => s + r.shortTermCents, 0),
      longTerm: inYear.reduce((s, r) => s + r.longTermCents, 0),
    },
    washSales: allRealised.filter((r) => r.washDisallowedCents > 0 && r.date >= since),
    harvest: harvestChances(allUnrealised, txs, today),
    location: locationHints(held),
    soldOutSales: soldOut,
  };
}
