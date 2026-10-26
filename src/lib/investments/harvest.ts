import { createHash, randomUUID } from "node:crypto";
import { AUTO_HARVEST_FROM } from "@/config/automatic-investing";
import { CORE_FUNDS, FUND_FACTS, FUND_NAMES, type AssetClass } from "@/config/funds";
import type { PrismaClient } from "@/generated/prisma/client";
import { brokeragePartner } from "@/lib/brokerage/partner";
import { db as defaultClient } from "@/lib/db";
import { loadInvestmentTaxes } from "@/lib/investment-taxes";
import { formatCents } from "@/lib/money";
import { isoDay as iso } from "@/lib/dates";

// Tax-loss harvesting (spec step 124's chances, put to use by steps 164 and 216): sell a
// holding that is down and buy a similar fund that isn't the same one, so the loss counts
// and the money stays invested. Only holdings with no wash-sale risk, from the harvesting
// season on. The selling is always either inside the person's automatic caps (step 164) or
// their own tap (the yearly review, step 216).

type Options = { client?: PrismaClient; now?: Date };

export type HarvestCandidate = {
  accountId: string;
  ticker: string;
  name: string;
  valueCents: number;
  lossCents: number;
  into: string;
  intoName: string;
};

const dominantClass = (ticker: string): Exclude<AssetClass, "other"> | null => {
  const mix = FUND_FACTS[ticker]?.mix;
  if (!mix) return null;
  const top = (Object.entries(mix) as [AssetClass, number][]).sort((a, b) => b[1] - a[1])[0];
  return top && top[0] !== "other" ? (top[0] as Exclude<AssetClass, "other">) : null;
};

export async function harvestCandidates(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<HarvestCandidate[]> {
  if (iso(now).slice(5) < AUTO_HARVEST_FROM) return [];
  const taxes = await loadInvestmentTaxes(userId, now.getUTCFullYear(), { client, now });
  return taxes.harvest.flatMap((chance): HarvestCandidate[] => {
    const h = chance.holding;
    if (chance.washRisk.boughtRecently || chance.washRisk.reinvests || !h.ticker) return [];
    const cls = dominantClass(h.ticker);
    const into = cls ? CORE_FUNDS[cls] : null;
    if (!into || into === h.ticker) return [];
    return [
      {
        accountId: h.accountId,
        ticker: h.ticker,
        name: h.name,
        valueCents: h.valueCents,
        lossCents: chance.lossCents,
        into,
        intoName: FUND_NAMES[into] ?? into,
      },
    ];
  });
}

// The same list gives the same key, so a tap only acts on what the person saw.
export const harvestKey = (c: HarvestCandidate[]) =>
  createHash("sha256")
    .update(JSON.stringify(c.map((x) => [x.accountId, x.ticker, x.valueCents])))
    .digest("hex")
    .slice(0, 24);

export const describeHarvest = (c: HarvestCandidate) =>
  `Harvested a ${formatCents(c.lossCents)} loss: sold ${c.name} (${formatCents(c.valueCents)}) and bought ${c.intoName}, a similar fund that isn't the same one, so the loss counts`;

// Sell the holding and buy the similar fund, through the brokerage partner.
export async function placeHarvest(
  userId: string,
  c: HarvestCandidate,
  { client = defaultClient, now = new Date() }: Options = {},
) {
  await brokeragePartner().placeOrders(
    userId,
    {
      batchId: randomUUID(),
      reason: "harvest",
      orders: [
        {
          accountId: c.accountId,
          ticker: c.ticker,
          securityName: c.name,
          side: "sell",
          amountCents: c.valueCents,
        },
        {
          accountId: c.accountId,
          ticker: c.into,
          securityName: c.intoName,
          side: "buy",
          amountCents: c.valueCents,
        },
      ],
    },
    { client, now },
  );
}
