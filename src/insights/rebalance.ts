import { createHash } from "node:crypto";
import { MIN_ORDER_CENTS } from "@/config/brokerage";
import {
  ASSET_CLASSES,
  CORE_FUNDS,
  DEMO_EMPLOYER_PLAN_MENU,
  EMPLOYER_PLAN_SUBTYPES,
  FUND_NAMES,
  type AssetClass,
} from "@/config/funds";
import { TARGET_MIXES, type RiskLevel } from "@/config/investing";
import { TAXABLE_INVESTMENT_SUBTYPES } from "@/config/tax";
import type { HoldingView, InvestmentAccountView } from "./investments";

// "Move to the recommended mix" (spec step 133): the orders that bring each account to the
// target mix for the person's risk level, with the mix before and after. Pure.
//
// Each account is rebalanced on its own (money can't move between accounts by trading),
// so its sales pay for its buys and its total stays the same. What's sold first:
// - in a taxable account, holdings with a loss, then the smallest gains, to keep the tax
//   bill down (an estimate of the gain realised is given);
// - elsewhere, the costliest funds first.
// Buys go into the low-cost index fund for each kind (CORE_FUNDS); in an employer plan,
// only if the plan offers it. Cash isn't bought: it's what's left in the account.

export type PlannedOrder = {
  accountId: string;
  accountName: string;
  ticker: string;
  name: string;
  side: "buy" | "sell";
  amountCents: number;
  // Sales in taxable accounts: the gain (or loss) the sale would realise, estimated from the
  // holding's cost basis.
  gainCents: number | null;
};

export type MixShare = { assetClass: AssetClass; label: string; share: number; target: number };

export type RebalancePlan = {
  riskLevel: RiskLevel;
  orders: PlannedOrder[];
  before: MixShare[];
  after: MixShare[];
  // Gains realised in taxable accounts, net of losses; an estimate.
  realisedGainCents: number;
  // Same orders, same key: a button only acts while the plan is what it showed.
  key: string;
};

type Position = {
  name: string;
  ticker: string | null;
  valueCents: number;
  mix: HoldingView["mix"];
};

const isEmployerPlan = (subtype: string | null) =>
  EMPLOYER_PLAN_SUBTYPES.includes((subtype ?? "").toLowerCase());
const isTaxable = (subtype: string | null) =>
  TAXABLE_INVESTMENT_SUBTYPES.includes((subtype ?? "").toLowerCase());

const dominant = (mix: HoldingView["mix"]) =>
  (Object.entries(mix) as [AssetClass, number][]).sort((a, b) => b[1] - a[1])[0] ?? null;

function classValues(positions: Position[]): Map<AssetClass, number> {
  const values = new Map<AssetClass, number>();
  for (const p of positions) {
    for (const [c, share] of Object.entries(p.mix) as [AssetClass, number][]) {
      values.set(c, (values.get(c) ?? 0) + p.valueCents * share);
    }
  }
  return values;
}

function shares(positions: Position[], riskLevel: RiskLevel): MixShare[] {
  const values = classValues(positions);
  const total = positions.reduce((s, p) => s + p.valueCents, 0);
  const target = TARGET_MIXES[riskLevel];
  return (Object.keys(ASSET_CLASSES) as AssetClass[])
    .filter((c) => c in target || (values.get(c) ?? 0) > 0)
    .map((c) => ({
      assetClass: c,
      label: ASSET_CLASSES[c],
      share: total > 0 ? (values.get(c) ?? 0) / total : 0,
      target: target[c as keyof typeof target] ?? 0,
    }));
}

function planAccount(account: InvestmentAccountView, riskLevel: RiskLevel): PlannedOrder[] {
  const target = TARGET_MIXES[riskLevel];
  const total = account.holdings.reduce((s, h) => s + h.valueCents, 0);
  if (total === 0) return [];
  const values = classValues(account.holdings);
  const gap = (c: AssetClass) =>
    total * (target[c as keyof typeof target] ?? 0) - (values.get(c) ?? 0);
  const taxable = isTaxable(account.subtype);
  const menu = isEmployerPlan(account.subtype) ? DEMO_EMPLOYER_PLAN_MENU : null;

  // Sales: holdings mostly in a kind there's too much of.
  const order = (h: HoldingView) =>
    taxable
      ? h.costBasisCents === null
        ? Number.POSITIVE_INFINITY
        : (h.valueCents - h.costBasisCents) / Math.max(1, h.valueCents)
      : -(h.expenseRatioBps ?? 0);
  const candidates = account.holdings
    .filter((h) => !h.isCash)
    .sort((a, b) => order(a) - order(b) || b.valueCents - a.valueCents);
  const orders: PlannedOrder[] = [];
  let proceeds = 0;
  for (const h of candidates) {
    const main = dominant(h.mix);
    if (!main || main[0] === "cash") continue;
    const [c, share] = main;
    const over = -gap(c);
    if (over < MIN_ORDER_CENTS) continue;
    const amount = Math.min(h.valueCents, Math.round(over / share));
    if (amount < MIN_ORDER_CENTS) continue;
    for (const [k, s] of Object.entries(h.mix) as [AssetClass, number][]) {
      values.set(k, (values.get(k) ?? 0) - amount * s);
    }
    values.set("cash", (values.get("cash") ?? 0) + amount);
    proceeds += amount;
    orders.push({
      accountId: account.id,
      accountName: account.name,
      ticker: h.ticker ?? h.name,
      name: h.name,
      side: "sell",
      amountCents: amount,
      gainCents:
        taxable && h.costBasisCents !== null
          ? Math.round(((h.valueCents - h.costBasisCents) * amount) / h.valueCents)
          : null,
    });
  }

  // Buys: the kinds there's too little of, paid for from the cash, leaving the cash target.
  const spendable = Math.max(0, (values.get("cash") ?? 0) - total * target.cash);
  const needs = (Object.keys(CORE_FUNDS) as (keyof typeof CORE_FUNDS)[])
    .filter((c) => c !== "cash")
    .map((c) => ({ c, need: Math.max(0, gap(c)), ticker: CORE_FUNDS[c] }))
    .filter((n) => n.need > 0 && (!menu || menu.includes(n.ticker)));
  const needed = needs.reduce((s, n) => s + n.need, 0);
  const budget = Math.min(spendable, needed);
  for (const n of needs) {
    const amount = Math.floor((budget * n.need) / needed);
    if (amount < MIN_ORDER_CENTS) continue;
    orders.push({
      accountId: account.id,
      accountName: account.name,
      ticker: n.ticker,
      name: FUND_NAMES[n.ticker] ?? n.ticker,
      side: "buy",
      amountCents: amount,
      gainCents: null,
    });
  }
  return orders;
}

// The positions after the orders: sales come out, buys go in, cash takes the difference.
function after(
  accounts: InvestmentAccountView[],
  orders: PlannedOrder[],
  mixOf: (t: string) => HoldingView["mix"],
): Position[] {
  const positions: Position[] = accounts.flatMap((a) =>
    a.holdings.map((h) => ({
      name: h.name,
      ticker: h.ticker,
      valueCents: h.valueCents,
      mix: h.mix,
    })),
  );
  for (const o of orders) {
    const sign = o.side === "buy" ? 1 : -1;
    positions.push({
      name: o.name,
      ticker: o.ticker,
      valueCents: sign * o.amountCents,
      mix: mixOf(o.ticker),
    });
    positions.push({
      name: "Cash",
      ticker: null,
      valueCents: -sign * o.amountCents,
      mix: { cash: 1 },
    });
  }
  return positions;
}

export function rebalancePlan(
  accounts: InvestmentAccountView[],
  riskLevel: RiskLevel,
  mixOf: (ticker: string) => HoldingView["mix"],
): RebalancePlan {
  const withHoldings = accounts.filter((a) => a.holdings.length > 0);
  const orders = withHoldings.flatMap((a) => planAccount(a, riskLevel));
  const before = withHoldings.flatMap((a) =>
    a.holdings.map((h) => ({
      name: h.name,
      ticker: h.ticker,
      valueCents: h.valueCents,
      mix: h.mix,
    })),
  );
  return {
    riskLevel,
    orders,
    before: shares(before, riskLevel),
    after: shares(after(withHoldings, orders, mixOf), riskLevel),
    realisedGainCents: orders.reduce((s, o) => s + (o.gainCents ?? 0), 0),
    key: createHash("sha256")
      .update(JSON.stringify(orders.map((o) => [o.accountId, o.ticker, o.side, o.amountCents])))
      .digest("hex")
      .slice(0, 24),
  };
}
