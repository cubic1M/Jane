import { PRICE_RISE_LEAD_DAYS } from "@/config/price-rises";
import type { PrismaClient } from "@/generated/prisma/client";
import type { Deadline } from "@/insights/deadlines";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { formatCents } from "@/lib/money";
import { priceRises, type PriceRise } from "@/planning/price-rises";

// Price rises seen before they land (spec step 243): loads the person's charges and finds the
// intro prices about to end and the yearly plans about to renew (src/planning/price-rises.ts).
// Each becomes a deadline (a month or more ahead) and one heads-up in the chat with the
// cheaper choice and what to say on the call.

type Options = { client?: PrismaClient; now?: Date };

const DAY_MS = 86_400_000;
// A year of charges and a little more, so a plan paid once a year is still in it.
const LOOKBACK_DAYS = 400;

export async function loadPriceRises(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<PriceRise[]> {
  const since = new Date(now.getTime() - LOOKBACK_DAYS * DAY_MS);
  const rows = await scopedFor(userId, client).transactions.findMany({
    where: { date: { gte: since, lte: now }, pending: false },
    select: { date: true, amountCents: true, description: true, pfcDetailed: true },
  });
  return priceRises(
    rows.map((r) => ({
      date: r.date.toISOString().slice(0, 10),
      amountCents: r.amountCents,
      description: r.description,
      pfc: r.pfcDetailed,
    })),
    now.toISOString().slice(0, 10),
  );
}

// "AT&T Fiber: intro price ends", a month or more ahead.
export function priceRiseDeadline(r: PriceRise): Deadline {
  return {
    key: `price_rise:${r.key}`,
    title: r.kind === "promo_end" ? `${r.name}: intro price ends` : `${r.name} renews`,
    date: r.date,
    kind: "price_rise",
    source: "transactions",
    amountCents: r.thenCents,
    href: "/deadlines",
    detail:
      r.kind === "promo_end"
        ? `About ${formatCents(r.nowCents)} a month now, likely about ${formatCents(r.thenCents)} after. ${r.cheaper}`
        : `About ${formatCents(r.thenCents)} for another year. ${r.cheaper}`,
  };
}

export async function priceRiseDeadlines(
  userId: string,
  options: { client: PrismaClient; now: Date },
): Promise<Deadline[]> {
  return (await loadPriceRises(userId, options))
    .filter((r) => r.daysLeft >= 0)
    .map(priceRiseDeadline);
}

// Whether a rise was raised in time: at least PRICE_RISE_LEAD_DAYS before it lands.
export const inTime = (r: PriceRise) => r.daysLeft >= PRICE_RISE_LEAD_DAYS;
