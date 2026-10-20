import { randomUUID } from "node:crypto";
import {
  AUTO_CASH_BUFFER_CENTS,
  AUTO_HARVEST_FROM,
  AUTO_MIN_INVEST_CENTS,
  AUTO_SECTOR,
  AUTO_SUMMARY_DAYS,
} from "@/config/automatic-investing";
import { CORE_FUNDS, FUND_FACTS, FUND_NAMES } from "@/config/funds";
import { MONEY_MARKET_TICKER } from "@/config/cash";
import type { AssetClass } from "@/config/funds";
import type { PrismaClient } from "@/generated/prisma/client";
import { adviceMode } from "@/lib/advice-mode";
import { logAudit } from "@/lib/audit";
import { brokeragePartner } from "@/lib/brokerage/partner";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { loadInvestmentTaxes } from "@/lib/investment-taxes";
import { syncDemoInvestments } from "@/lib/plaid/sync";
import { mayAct, recordAct } from "@/lib/sector-autopilot";
import { contributionBuys } from "@/planning/auto-invest";
import { profileSummary } from "@/planning/investor-profile";
import { formatCents } from "@/lib/money";
import { loadInvestments } from "./holdings";
import { profileOf } from "./profile";
import { loadRebalance, placeRebalance } from "./rebalance";

// Fully automatic investing (spec step 164), run nightly. Within the person's caps at the
// investing sector's "Everything allowed", Jane rebalances, invests new cash and harvests
// losses (step 124) through the simulated brokerage. Each action goes in the autopilot log
// with its reason (src/lib/sector-autopilot.ts recordAct); one over a cap is logged as
// asked-first and left for the person's tap. A failure in one action never stops the rest.

type Options = { client?: PrismaClient; now?: Date };

const iso = (d: Date) => d.toISOString().slice(0, 10);
const money = formatCents;

export type AutomaticResult = { did: string[]; asked: string[] };

const dominantClass = (ticker: string | null): Exclude<AssetClass, "other"> | null => {
  const mix = ticker ? FUND_FACTS[ticker]?.mix : undefined;
  if (!mix) return null;
  const top = (Object.entries(mix) as [AssetClass, number][]).sort((a, b) => b[1] - a[1])[0];
  return top && top[0] !== "other" ? (top[0] as Exclude<AssetClass, "other">) : null;
};

export async function runAutomaticInvesting(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<AutomaticResult | null> {
  const db = scopedFor(userId, client);
  const [advice, answers] = await Promise.all([
    adviceMode(userId, { client }),
    profileOf(userId, { client }),
  ]);
  const profile = profileSummary(answers, iso(now));
  if (!advice || !profile.complete) return null;
  // The level gate, free of cost: nothing below "Everything allowed" does anything here.
  if (!(await mayAct(userId, AUTO_SECTOR, { needs: "all", cents: 0 }, { client, now })).ok) {
    return null;
  }
  const result: AutomaticResult = { did: [], asked: [] };
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  // A move over a cap is logged once a month as "asked first", and left to the person.
  const ask = async (what: string) => {
    const seen = await db.autopilotActs.count({
      where: { sector: AUTO_SECTOR, what, createdAt: { gte: monthStart } },
    });
    if (seen === 0) await recordAct(userId, AUTO_SECTOR, 0, what, { client, now });
    result.asked.push(what);
  };
  const act = async (cents: number, what: string, place: () => Promise<void>) => {
    const may = await mayAct(userId, AUTO_SECTOR, { needs: "all", cents }, { client, now });
    if (!may.ok) {
      const cap = may.reason === "monthly_cap" ? "this month's cap" : "the cap on one move";
      await ask(`Asked first, over ${cap}: ${what}`);
      return;
    }
    await place();
    await recordAct(userId, AUTO_SECTOR, cents, what, { client, now });
    await logAudit(
      { type: "system", id: null },
      "autopilot_investing_acted",
      { type: "user", id: userId },
      { cents, what },
    );
    result.did.push(what);
  };

  // 1. Rebalance to the target mix.
  try {
    const { plan } = await loadRebalance(userId, { client, now });
    if (plan && plan.orders.length > 0) {
      const buys = plan.orders
        .filter((o) => o.side === "buy")
        .reduce((s, o) => s + o.amountCents, 0);
      await act(
        buys,
        `Rebalanced ${money(buys)} to your target mix (it had drifted off target)`,
        async () => {
          await placeRebalance(userId, plan.key, { client, now });
        },
      );
    }
  } catch (error) {
    console.error("Automatic rebalance failed", { error: String(error) });
  }

  // 2. Harvest losses (step 124), only without a wash-sale risk, into a similar fund.
  try {
    if (iso(now).slice(5) >= AUTO_HARVEST_FROM) {
      const taxes = await loadInvestmentTaxes(userId, now.getUTCFullYear(), { client, now });
      for (const chance of taxes.harvest.filter(
        (h) => !h.washRisk.boughtRecently && !h.washRisk.reinvests,
      )) {
        const h = chance.holding;
        const cls = dominantClass(h.ticker);
        const into = cls ? CORE_FUNDS[cls] : null;
        if (!h.ticker || !into || into === h.ticker) continue;
        await act(
          h.valueCents,
          `Harvested a ${money(chance.lossCents)} loss: sold ${h.name} (${money(h.valueCents)}) and bought ${FUND_NAMES[into] ?? into}, a similar fund that isn't the same one, so the loss counts`,
          async () => {
            const batchId = randomUUID();
            await brokeragePartner().placeOrders(
              userId,
              {
                batchId,
                reason: "harvest",
                orders: [
                  {
                    accountId: h.accountId,
                    ticker: h.ticker!,
                    securityName: h.name,
                    side: "sell",
                    amountCents: h.valueCents,
                  },
                  {
                    accountId: h.accountId,
                    ticker: into,
                    securityName: FUND_NAMES[into] ?? into,
                    side: "buy",
                    amountCents: h.valueCents,
                  },
                ],
              },
              { client, now },
            );
          },
        );
      }
    }
  } catch (error) {
    console.error("Automatic harvest failed", { error: String(error) });
  }

  // 3. Invest new cash sitting in a brokerage account, above a cushion.
  try {
    const investments = await loadInvestments(userId, { client, now });
    for (const a of investments.accounts.filter((x) => x.subtype === "brokerage")) {
      const cash = a.holdings
        .filter((h) => h.isCash && h.ticker !== MONEY_MARKET_TICKER)
        .reduce((s, h) => s + h.valueCents, 0);
      const amount = cash - AUTO_CASH_BUFFER_CENTS;
      if (amount < AUTO_MIN_INVEST_CENTS) continue;
      await act(
        amount,
        `Invested ${money(amount)} of new cash in ${a.name} in your target mix`,
        async () => {
          await brokeragePartner().placeOrders(
            userId,
            {
              batchId: randomUUID(),
              reason: "auto_cash",
              orders: contributionBuys(amount, profile.riskLevel).map((b) => ({
                accountId: a.id,
                ticker: b.ticker,
                securityName: FUND_NAMES[b.ticker] ?? b.ticker,
                side: "buy" as const,
                amountCents: b.amountCents,
              })),
            },
            { client, now },
          );
        },
      );
    }
  } catch (error) {
    console.error("Automatic cash investing failed", { error: String(error) });
  }

  if (result.did.length > 0) {
    const item = await db.accounts.findFirst({
      where: { type: "investment" },
      select: { itemId: true },
    });
    if (item?.itemId) await syncDemoInvestments(item.itemId, { client, now });
  }
  return result;
}

export async function runAutomaticInvestingForAll({
  client = defaultClient,
  now = new Date(),
}: Options = {}) {
  const sectors = await client.autopilotSector.findMany({
    where: { sector: AUTO_SECTOR, level: "all", user: { deletedAt: null } },
    select: { userId: true },
    take: 500,
  });
  let acted = 0;
  for (const { userId } of sectors) {
    try {
      const r = await runAutomaticInvesting(userId, { client, now });
      acted += r?.did.length ?? 0;
    } catch (error) {
      console.error("Automatic investing failed", { error: String(error) });
    }
  }
  return { people: sectors.length, acted };
}

// The month's log for the summary: what Jane did on her own, and what she asked first.
export async function automaticLog(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
) {
  const rows = await scopedFor(userId, client).autopilotActs.findMany({
    where: {
      sector: AUTO_SECTOR,
      createdAt: { gte: new Date(now.getTime() - AUTO_SUMMARY_DAYS * 86_400_000) },
    },
    orderBy: { createdAt: "asc" },
    select: { what: true, cents: true, createdAt: true },
  });
  return {
    did: rows.filter((r) => !r.what.startsWith("Asked first")),
    asked: rows.filter((r) => r.what.startsWith("Asked first")),
  };
}
