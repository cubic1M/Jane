import { randomUUID } from "node:crypto";
import {
  DEFAULT_GAIN_RATE,
  DEFAULT_ORDINARY_RATE,
  PRE_TAX_SUBTYPES,
  ROTH_SUBTYPES,
  TAXABLE_SUBTYPES,
  type AccountKind,
} from "@/config/location";
import { CORE_FUNDS, FUND_FACTS, FUND_NAMES } from "@/config/funds";
import { CAPITAL_GAINS_BRACKETS } from "@/config/tax-rates";
import type { PrismaClient } from "@/generated/prisma/client";
import type { HoldingView } from "@/insights/investments";
import { adviceMode } from "@/lib/advice-mode";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { brokeragePartner } from "@/lib/brokerage/partner";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { syncDemoInvestments } from "@/lib/plaid/sync";
import { loadTaxEstimate } from "@/lib/tax-estimate";
import { locationPlan, type Class, type LocationPlan, type PlanAccount } from "@/planning/location";
import { marginalRateOf } from "@/planning/tax-estimate";
import { loadInvestments, type Investments } from "./holdings";

// The right investment in the right account (spec step 231, demo advice), for its page,
// Jane's answers and its buttons. Every one of the person's own accounts counts as one
// allocation (a partner's accounts only if they were shared, and none are). The swaps keep
// the overall mix the same, are bought and sold together, and each one that sells at a gain
// says what it costs. A tap does the swaps that cost no tax together; the others are each
// the person's own tap.

type Options = { client?: PrismaClient; now?: Date; investments?: Investments };

export class LocationError extends Error {}

const kindOf = (subtype: string | null): AccountKind | null => {
  const s = (subtype ?? "").toLowerCase();
  if (PRE_TAX_SUBTYPES.includes(s)) return "pre_tax";
  if (ROTH_SUBTYPES.includes(s)) return "roth";
  if (TAXABLE_SUBTYPES.includes(s)) return "taxable";
  return null;
};

// A fund that is one pure class and can be moved; null for target-date, cash and mixed funds.
function moveClass(h: HoldingView): Class | null {
  if (h.isCash) return null;
  const m = h.mix;
  for (const c of ["bonds", "us_stocks", "intl_stocks"] as const) if ((m[c] ?? 0) >= 0.99) return c;
  return null;
}

export type LocationView = {
  advice: boolean;
  plan: LocationPlan | null;
  accounts: { id: string; name: string; kind: AccountKind }[];
  ordinaryRate: number;
  gainRate: number;
  fromEstimate: boolean;
};

export async function loadLocation(
  userId: string,
  { client = defaultClient, now = new Date(), investments: loaded }: Options = {},
): Promise<LocationView> {
  const [advice, investments, estimate] = await Promise.all([
    adviceMode(userId, { client }),
    loaded ?? loadInvestments(userId, { client, now }),
    loadTaxEstimate(userId, { client, now }).catch(() => null),
  ]);
  const ordinary = estimate?.estimate.marginalRate ?? DEFAULT_ORDINARY_RATE;
  const gainRate =
    estimate?.estimate.taxableCents != null
      ? marginalRateOf(
          estimate.estimate.taxableCents,
          CAPITAL_GAINS_BRACKETS[estimate.estimate.filingStatus ?? "single"],
        )
      : DEFAULT_GAIN_RATE;
  const accounts: PlanAccount[] = investments.accounts.flatMap((a) => {
    const kind = kindOf(a.subtype);
    if (!kind) return [];
    return [
      {
        id: a.id,
        name: a.name,
        kind,
        holdings: a.holdings.map((h) => ({
          ticker: h.ticker ?? h.name,
          name: h.name,
          valueCents: h.valueCents,
          gainCents: h.gainCents,
          moveClass: moveClass(h),
        })),
      },
    ];
  });
  const yieldOf = (c: Class) => FUND_FACTS[CORE_FUNDS[c === "bonds" ? "bonds" : c]]?.yieldBps ?? 0;
  const plan =
    accounts.length > 1
      ? locationPlan({
          accounts,
          yieldBps: {
            bonds: yieldOf("bonds"),
            us_stocks: yieldOf("us_stocks"),
            intl_stocks: yieldOf("intl_stocks"),
          },
          payoutRate: { bonds: ordinary, us_stocks: gainRate, intl_stocks: gainRate },
          gainRate,
        })
      : null;
  return {
    advice,
    plan,
    accounts: accounts.map((a) => ({ id: a.id, name: a.name, kind: a.kind })),
    ordinaryRate: ordinary,
    gainRate,
    fromEstimate: estimate !== null,
  };
}

// Tap: make swaps. "free" does every swap that costs no tax, together; a swap's key does
// that one swap. Only while the plan is the one the person saw.
export async function makeSwaps(
  userId: string,
  planKey: string,
  which: "free" | string,
  { client = defaultClient, now = new Date() }: Options = {},
) {
  const view = await loadLocation(userId, { client, now });
  if (!view.advice) throw new LocationError("This is only in demo advice mode for now.");
  if (!view.plan || view.plan.key !== planKey)
    throw new LocationError("Your accounts changed since this plan. Here's the new one.");
  const swaps = view.plan.swaps.filter((s) =>
    which === "free" ? s.taxCents === 0 : s.key === which,
  );
  if (swaps.length === 0) throw new LocationError("There's nothing to swap that way.");
  const investments = await loadInvestments(userId, { client, now });
  const partner = brokeragePartner();
  const batchId = randomUUID();
  const orders: Parameters<typeof partner.placeOrders>[1]["orders"] = [];
  const sellFrom = (accountId: string, c: Class, amount: number) => {
    const holdings = (investments.accounts.find((a) => a.id === accountId)?.holdings ?? [])
      .filter((h) => moveClass(h) === c)
      .sort(
        (a, b) =>
          (a.gainCents ?? 0) / Math.max(1, a.valueCents) -
          (b.gainCents ?? 0) / Math.max(1, b.valueCents),
      );
    let left = amount;
    for (const h of holdings) {
      const take = Math.min(left, h.valueCents);
      if (take <= 0 || !h.ticker) continue;
      orders.push({
        accountId,
        ticker: h.ticker,
        securityName: h.name,
        side: "sell",
        amountCents: take,
      });
      left -= take;
      if (left <= 0) break;
    }
    if (left > 0)
      throw new LocationError("Your holdings changed since this plan. Here's the new one.");
  };
  const buyIn = (accountId: string, c: Class, amount: number) =>
    orders.push({
      accountId,
      ticker: CORE_FUNDS[c],
      securityName: FUND_NAMES[CORE_FUNDS[c]] ?? CORE_FUNDS[c],
      side: "buy",
      amountCents: amount,
    });
  for (const s of swaps) {
    sellFrom(s.a.accountId, s.a.sell, s.amountCents);
    sellFrom(s.b.accountId, s.b.sell, s.amountCents);
    buyIn(s.a.accountId, s.a.buy, s.amountCents);
    buyIn(s.b.accountId, s.b.buy, s.amountCents);
  }
  await partner.placeOrders(userId, { batchId, reason: "asset_location", orders }, { client, now });
  await logAudit(
    { type: "user", id: userId },
    "brokerage_orders_placed",
    { type: "brokerage_batch", id: batchId },
    { reason: "asset_location", orders: orders.length, simulated: partner.simulated },
  );
  await track(userId, "asset_location_swapped", { swaps: swaps.length });
  const items = new Set<string>();
  for (const s of swaps)
    for (const id of [s.a.accountId, s.b.accountId]) {
      const acc = await scopedFor(userId, client).accounts.findFirst({
        where: { id },
        select: { itemId: true },
      });
      if (acc?.itemId) items.add(acc.itemId);
    }
  for (const itemId of items) await syncDemoInvestments(itemId, { client, now });
  return { swaps: swaps.length, taxCents: swaps.reduce((s, x) => s + x.taxCents, 0) };
}
