import type { PrismaClient } from "@/generated/prisma/client";
import type { Deadline } from "@/insights/deadlines";
import { normalizeMerchant } from "@/data-sources/merchant";
import { loadTransactionsBetween } from "@/detection/engine";
import { dayLabel } from "@/lib/day-label";
import { db as defaultClient } from "@/lib/db";
import { formatCents } from "@/lib/money";
import { priceRises, type PriceRise } from "@/planning/price-rises";
import { DAY_MS } from "@/lib/dates";

// Price rises seen before they land (spec step 243): loads the person's charges and finds the
// intro prices about to end and the yearly plans about to renew (src/planning/price-rises.ts).
// Each becomes a deadline (a month or more ahead) and one heads-up in the chat with the
// cheaper choice and what to say on the call.

type Options = { client?: PrismaClient; now?: Date };

// A year of charges and a little more, so a plan paid once a year is still in it.
const LOOKBACK_DAYS = 400;

export async function loadPriceRises(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<PriceRise[]> {
  const today = now.toISOString().slice(0, 10);
  // Read as the rest of the app reads them, under the names it gives (not "Amc Online -- Ks
  // 12/06"), so the chat's search finds what a card names.
  const rows = await loadTransactionsBetween(userId, {
    client,
    from: new Date(now.getTime() - LOOKBACK_DAYS * DAY_MS).toISOString().slice(0, 10),
    to: today,
  });
  return priceRises(
    rows.map((r) => ({
      date: r.date,
      amountCents: r.amountCents,
      description: r.description,
      pfc: r.pfcDetailed,
      merchantName: r.merchantName ?? normalizeMerchant(r.description)?.name ?? null,
    })),
    today,
  );
}

// "AT&T Fiber: intro price ends", a month or more ahead.
export function priceRiseDeadline(r: PriceRise): Deadline {
  return {
    key: `price_rise:${r.key}`,
    title: `${r.name}: intro price ends`,
    date: r.date,
    kind: "price_rise",
    source: "transactions",
    amountCents: r.thenCents,
    href: "/deadlines",
    detail: `About ${formatCents(r.nowCents)} a month now (last charged ${dayLabel(r.chargedOn)}), likely about ${formatCents(r.thenCents)} after. ${r.cheaper}`,
    chargedOn: r.chargedOn,
  };
}

// Only intro prices ending go on the deadlines as "Price goes up". A yearly plan renewing is a
// renewal, not a rise: it is there already as "Renewal" from detection's yearly plans
// (src/insights/deadlines.ts renewalDeadlines), by the same rule (isYearlyPlanCharge), and here
// it was listed again under "Price goes up" (founder's live /deadlines, 10-29).
export async function priceRiseDeadlines(
  userId: string,
  options: { client: PrismaClient; now: Date },
): Promise<Deadline[]> {
  return (await loadPriceRises(userId, options))
    .filter((r) => r.kind === "promo_end" && r.daysLeft >= 0)
    .map(priceRiseDeadline);
}
