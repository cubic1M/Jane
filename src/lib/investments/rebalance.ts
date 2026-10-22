import { randomUUID } from "node:crypto";
import { mixOfTicker } from "@/config/funds";
import type { PrismaClient } from "@/generated/prisma/client";
import { rebalancePlan, type RebalancePlan } from "@/insights/rebalance";
import { adviceMode } from "@/lib/advice-mode";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { brokeragePartner, type Confirmation } from "@/lib/brokerage/partner";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { syncDemoInvestments } from "@/lib/plaid/sync";
import { profileOf } from "./profile";
import { loadPrefs } from "./values";
import { coreFundsFor } from "@/planning/values";
import { loadInvestments, type Investments } from "./holdings";
import { profileSummary } from "@/planning/investor-profile";

// "Move to the recommended mix" with one tap (spec step 133). The plan is worked out from
// the holdings and the investor profile; the tap sends its orders to the brokerage partner
// (the simulation until a real one is connected), only in demo advice mode, only with a
// finished profile, and only while the plan is still the one the person saw. Moving money
// always waits for that tap, at every autopilot level.

type Options = { client?: PrismaClient; now?: Date };

export async function loadRebalance(
  userId: string,
  {
    client = defaultClient,
    now = new Date(),
    investments: loaded,
  }: Options & { investments?: Investments } = {},
): Promise<{ advice: boolean; plan: RebalancePlan | null; investments: Investments }> {
  const [investments, answers, advice, prefs] = await Promise.all([
    loaded ?? loadInvestments(userId, { client, now }),
    profileOf(userId, { client }),
    adviceMode(userId, { client }),
    loadPrefs(userId, { client }),
  ]);
  const profile = profileSummary(answers, now.toISOString().slice(0, 10));
  return {
    advice,
    investments,
    plan:
      advice && profile.complete
        ? rebalancePlan(investments.accounts, profile.riskLevel, mixOfTicker, coreFundsFor(prefs))
        : null,
  };
}

export class RebalanceError extends Error {}

export async function placeRebalance(
  userId: string,
  key: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<{ confirmations: Confirmation[]; plan: RebalancePlan }> {
  const { advice, plan } = await loadRebalance(userId, { client, now });
  if (!advice) throw new RebalanceError("Trading is only in demo advice mode for now.");
  if (!plan) throw new RebalanceError("Answer the four profile questions first.");
  if (plan.orders.length === 0) throw new RebalanceError("Your mix is already on target.");
  if (plan.key !== key) {
    throw new RebalanceError("Your investments changed since this plan. Here's the new one.");
  }
  const partner = brokeragePartner();
  const batchId = randomUUID();
  const confirmations = await partner.placeOrders(
    userId,
    {
      batchId,
      reason: "rebalance",
      // Sales first, so their cash pays for the buys.
      orders: [...plan.orders]
        .sort((a, b) => (a.side === b.side ? 0 : a.side === "sell" ? -1 : 1))
        .map((o) => ({
          accountId: o.accountId,
          ticker: o.ticker,
          securityName: o.name,
          side: o.side,
          amountCents: o.amountCents,
        })),
    },
    { client, now },
  );
  await logAudit(
    { type: "user", id: userId },
    "brokerage_orders_placed",
    { type: "brokerage_batch", id: batchId },
    { reason: "rebalance", orders: confirmations.length, simulated: partner.simulated },
  );
  await track(userId, "rebalance_placed", {
    orders: confirmations.length,
    simulated: partner.simulated,
  });
  // The demo bank shows the new holdings straight away.
  const items = await scopedFor(userId, client).accounts.findMany({
    where: { id: { in: [...new Set(plan.orders.map((o) => o.accountId))] }, itemId: { not: null } },
    select: { itemId: true },
    distinct: ["itemId"],
  });
  for (const { itemId } of items) {
    if (itemId) await syncDemoInvestments(itemId, { client, now });
  }
  return { confirmations, plan };
}

// The person's orders, newest first, for the page and the chat.
export async function recentOrders(
  userId: string,
  { client = defaultClient, limit = 20 }: { client?: PrismaClient; limit?: number } = {},
) {
  return scopedFor(userId, client).brokerageOrders.findMany({
    select: {
      id: true,
      batchId: true,
      reason: true,
      partner: true,
      ticker: true,
      securityName: true,
      side: true,
      amountCents: true,
      quantity: true,
      priceCents: true,
      status: true,
      confirmation: true,
      placedAt: true,
      account: { select: { name: true } },
    },
    orderBy: [{ placedAt: "desc" }, { id: "asc" }],
    take: limit,
  });
}
