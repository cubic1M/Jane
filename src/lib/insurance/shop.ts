import {
  PRICE_UP_LOOKBACK_DAYS,
  PRICE_UP_TOLERANCE_CENTS,
  RESHOP_DAILY_LIMIT,
  RESHOP_DAYS_BEFORE_RENEWAL,
  RESHOP_NEWS_DAYS,
  PICK_REFRESH_DAYS,
} from "@/config/insurance";
import { autopilotOf } from "@/lib/autopilot";
import { daysBetween } from "@/detection/units";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { adviceMode } from "@/lib/advice-mode";
import { track } from "@/lib/analytics";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { normalizeMerchant } from "@/data-sources/merchant";
import { isQuotable, partnerFor, type InsurancePartner } from "./partner";
import { expectedSpend, expectedYearlyCost } from "./health";
import { loadHousehold } from "./household";
import { pickQuote } from "./pick";
import { POLICY_SELECT, nextRenewal, toPolicy, yearlyPremium, type Policy } from "./policies";
import { requestQuotes, type StoredQuote } from "./quotes";

// Shopped for you (spec step 104). Jane reshops each policy by herself, at every autopilot
// level: RESHOP_DAYS_BEFORE_RENEWAL days before it renews, and whenever its price goes up
// (a higher price saved on the policy, or a higher charge from the insurer). Each reshop is
// kept as a shop: the pick and why, or "nothing better". The person then says Yes (a
// switch, spec step 105) or Not now. Nothing is bought without that tap.

type Options = { client?: PrismaClient; now?: Date; partner?: InsurancePartner | null };

export type ShopReason = "renewal" | "price_up" | "asked";
export type ShopStatus = "open" | "no_better" | "accepted" | "declined" | "expired";

export type Shop = {
  id: string;
  policyId: string;
  reason: ShopReason;
  status: ShopStatus;
  currentAnnualCents: number;
  pick: StoredQuote | null;
  runnersUp: StoredQuote[];
  savingCents: number | null;
  why: string[];
  quoteCount: number;
  demo: boolean;
  expiresAt: Date | null;
  createdAt: Date;
};

const SHOP_SELECT = {
  id: true,
  policyId: true,
  reason: true,
  status: true,
  currentAnnualCents: true,
  pick: true,
  runnersUp: true,
  savingCents: true,
  why: true,
  quoteCount: true,
  demo: true,
  expiresAt: true,
  createdAt: true,
} as const;

// A quote as stored on a shop (JSON), back with its dates.
function quoteOf(value: unknown): StoredQuote | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const q = value as StoredQuote & { expiresAt: string; createdAt: string };
  return { ...q, expiresAt: new Date(q.expiresAt), createdAt: new Date(q.createdAt) };
}

export function toShop(row: Prisma.InsuranceShopGetPayload<{ select: typeof SHOP_SELECT }>): Shop {
  return {
    id: row.id,
    policyId: row.policyId,
    reason: row.reason as ShopReason,
    status: row.status as ShopStatus,
    currentAnnualCents: row.currentAnnualCents,
    pick: quoteOf(row.pick),
    runnersUp: (Array.isArray(row.runnersUp) ? row.runnersUp : []).flatMap((q) => {
      const quote = quoteOf(q);
      return quote ? [quote] : [];
    }),
    savingCents: row.savingCents,
    why: row.why,
    quoteCount: row.quoteCount,
    demo: row.demo,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
  };
}

// Spec step 149: what a health policy costs in a year with the person's usual care, to
// compare plans on; null for other kinds or when its terms aren't on file.
async function currentTotal(userId: string, policy: Policy, client: PrismaClient, now: Date) {
  if (policy.kind !== "health") return null;
  const household = await loadHousehold(userId, { client, now });
  return expectedYearlyCost(policy, yearlyPremium(policy), expectedSpend(household));
}

const json = (q: StoredQuote) => JSON.parse(JSON.stringify(q)) as Prisma.InputJsonObject;

// Reshops one policy now and keeps the result. Null when it can't be shopped (no partner,
// not demo advice mode for the pick, a kind the partner doesn't quote, no price to compare
// against) or this reshop already happened.
export async function shopPolicy(
  userId: string,
  policy: Policy,
  reason: ShopReason,
  key: string,
  { client = defaultClient, now = new Date(), partner }: Options = {},
): Promise<Shop | null> {
  const current = yearlyPremium(policy);
  if (current === null || !isQuotable(policy.kind)) return null;
  const db = scopedFor(userId, client);
  if (await db.insuranceShops.findFirst({ where: { key }, select: { id: true } })) return null;
  const quoting = partner === undefined ? await partnerFor(userId, { client }) : partner;
  // Picking is advice: only in demo advice mode (spec step 98).
  if (!quoting || !(await adviceMode(userId, { client }))) return null;
  const result = await requestQuotes(userId, policy.id, { client, now, partner: quoting });
  if (result.kind !== "quotes") return null;
  const chosen = pickQuote(
    policy,
    current,
    result.quotes,
    await currentTotal(userId, policy, client, now),
  );
  // Another open shop for the same policy is replaced by this one.
  await db.insuranceShops.updateMany({
    where: { policyId: policy.id, status: "open" },
    data: { status: "expired" },
  });
  const row = await db.insuranceShops.create({
    data: {
      userId,
      policyId: policy.id,
      key,
      reason,
      currentAnnualCents: current,
      status: chosen ? "open" : "no_better",
      pick: chosen ? json(chosen.pick) : undefined,
      runnersUp: chosen ? chosen.runnersUp.map(json) : [],
      savingCents: chosen?.savingCents ?? null,
      why: chosen?.why ?? [],
      quoteCount: result.quotes.length,
      demo: result.quotes.some((q) => q.demo),
      expiresAt: chosen?.pick.expiresAt ?? null,
      createdAt: now,
    },
    select: SHOP_SELECT,
  });
  await track(userId, "insurance_reshopped", {
    kind: policy.kind,
    reason,
    found: chosen !== null,
    saving_cents: chosen?.savingCents ?? 0,
  });
  return toShop(row);
}

const day = (date: Date) => date.toISOString().slice(0, 10);

// The newest charge from the policy's insurer above its price, in the last
// PRICE_UP_LOOKBACK_DAYS: the price went up. Null when there's none.
export async function higherCharge(
  userId: string,
  policy: Policy,
  { client, now }: { client: PrismaClient; now: Date },
): Promise<number | null> {
  if (!policy.merchantKey || policy.premiumCents === null) return null;
  const since = new Date(now.getTime() - PRICE_UP_LOOKBACK_DAYS * 86_400_000);
  const rows = await scopedFor(userId, client).transactions.findMany({
    where: { date: { gte: since }, amountCents: { gt: 0 } },
    select: { amountCents: true, merchantName: true, description: true },
    orderBy: { date: "desc" },
  });
  const charge = rows.find(
    (r) => normalizeMerchant(r.merchantName ?? r.description)?.key === policy.merchantKey,
  );
  return charge && charge.amountCents > policy.premiumCents + PRICE_UP_TOLERANCE_CENTS
    ? charge.amountCents
    : null;
}

// Why a policy is due a reshop today, with the key that stops it running twice, or null.
export async function reshopDue(
  userId: string,
  policy: Policy,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<{ reason: ShopReason; key: string } | null> {
  const asOf = day(now);
  const charge = await higherCharge(userId, policy, { client, now });
  if (charge !== null) return { reason: "price_up", key: `price:${policy.id}:charge:${charge}` };
  const last = await scopedFor(userId, client).insuranceShops.findFirst({
    where: { policyId: policy.id },
    select: { currentAnnualCents: true },
    orderBy: { createdAt: "desc" },
  });
  const yearly = yearlyPremium(policy);
  if (last && yearly !== null && yearly > last.currentAnnualCents) {
    return { reason: "price_up", key: `price:${policy.id}:${yearly}` };
  }
  const renews = nextRenewal(policy, asOf);
  if (renews && daysBetween(asOf, renews) <= RESHOP_DAYS_BEFORE_RENEWAL) {
    return { reason: "renewal", key: `renewal:${policy.id}:${renews}` };
  }
  return null;
}

// Spec step 108: at "handle everything", Jane keeps her open picks ready for the one tap:
// quotes about to expire are asked for again and the same pick is updated in place (no new
// message). A pick that's no longer the best, or gone, is left to expire.
export async function refreshPicks(
  userId: string,
  { client = defaultClient, now = new Date(), partner }: Options = {},
): Promise<number> {
  if ((await autopilotOf(userId, { client })) !== "all") return 0;
  const db = scopedFor(userId, client);
  const soon = new Date(now.getTime() + PICK_REFRESH_DAYS * 86_400_000);
  const due = await db.insuranceShops.findMany({
    where: { status: "open", expiresAt: { gt: now, lte: soon } },
    select: SHOP_SELECT,
  });
  let refreshed = 0;
  for (const shop of due.map(toShop)) {
    const row = await db.insurancePolicies.findFirst({
      where: { id: shop.policyId, status: "active" },
      select: POLICY_SELECT,
    });
    if (!row || !shop.pick) continue;
    const policy = toPolicy(row);
    const result = await requestQuotes(userId, policy.id, { client, now, partner });
    if (result.kind !== "quotes") continue;
    const chosen = pickQuote(
      policy,
      shop.currentAnnualCents,
      result.quotes,
      await currentTotal(userId, policy, client, now),
    );
    if (!chosen || chosen.pick.carrier.id !== shop.pick.carrier.id) continue;
    await db.insuranceShops.updateMany({
      where: { id: shop.id, status: "open" },
      data: {
        pick: json(chosen.pick),
        runnersUp: chosen.runnersUp.map(json),
        savingCents: chosen.savingCents,
        why: chosen.why,
        quoteCount: result.quotes.length,
        expiresAt: chosen.pick.expiresAt,
      },
    });
    refreshed += 1;
  }
  return refreshed;
}

// Every policy of this person that's due, reshopped now. Returns the new shops.
export async function reshopPerson(
  userId: string,
  { client = defaultClient, now = new Date(), partner }: Options = {},
): Promise<Shop[]> {
  const quoting = partner === undefined ? await partnerFor(userId, { client }) : partner;
  if (!quoting) return [];
  const rows = await scopedFor(userId, client).insurancePolicies.findMany({
    where: { status: "active" },
    select: POLICY_SELECT,
  });
  await refreshPicks(userId, { client, now, partner: quoting });
  const shops: Shop[] = [];
  for (const policy of rows.map(toPolicy)) {
    const due = await reshopDue(userId, policy, { client, now });
    if (!due) continue;
    const shop = await shopPolicy(userId, policy, due.reason, due.key, {
      client,
      now,
      partner: quoting,
    });
    if (shop) shops.push(shop);
  }
  return shops;
}

// The daily run (Vercel Cron): everyone with an active policy, reshopped where due. Open
// picks past their quote's expiry are marked expired.
export async function reshopAll({
  client = defaultClient,
  now = new Date(),
}: Pick<Options, "client" | "now"> = {}): Promise<{ people: number; shops: number }> {
  // A system job across users: ids only; everything after is scoped to the person.
  await client.insuranceShop.updateMany({
    where: { status: "open", expiresAt: { lte: now } },
    data: { status: "expired" },
  });
  const people = await client.insurancePolicy.findMany({
    where: { status: "active" },
    select: { userId: true },
    distinct: ["userId"],
    orderBy: { userId: "asc" },
    take: RESHOP_DAILY_LIMIT,
  });
  let shops = 0;
  for (const { userId } of people) {
    try {
      shops += (await reshopPerson(userId, { client, now })).length;
    } catch (error) {
      console.error("Insurance reshop failed", { userId, error: String(error) });
    }
  }
  return { people: people.length, shops };
}

// "Find me cheaper car insurance": a reshop the person asked for, now.
export async function shopNow(
  userId: string,
  policyId: string,
  { client = defaultClient, now = new Date(), partner }: Options = {},
): Promise<Shop | null> {
  const row = await scopedFor(userId, client).insurancePolicies.findFirst({
    where: { id: policyId, status: "active" },
    select: POLICY_SELECT,
  });
  if (!row) return null;
  return shopPolicy(userId, toPolicy(row), "asked", `asked:${policyId}:${now.toISOString()}`, {
    client,
    now,
    partner,
  });
}

export async function openShops(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<Shop[]> {
  const rows = await scopedFor(userId, client).insuranceShops.findMany({
    where: { status: "open", OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    select: SHOP_SELECT,
    orderBy: { createdAt: "desc" },
  });
  return rows.map(toShop);
}

// The newest shop of each policy that found nothing better, from the last few days, for
// "I checked: nothing better" in the chat.
export async function recentNoBetter(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<Shop[]> {
  const rows = await scopedFor(userId, client).insuranceShops.findMany({
    where: {
      status: "no_better",
      reason: { not: "asked" },
      createdAt: { gte: new Date(now.getTime() - RESHOP_NEWS_DAYS * 86_400_000) },
    },
    select: SHOP_SELECT,
    orderBy: { createdAt: "desc" },
  });
  return rows.map(toShop);
}

export async function shopById(
  userId: string,
  shopId: string,
  { client = defaultClient }: Options = {},
): Promise<Shop | null> {
  const row = await scopedFor(userId, client).insuranceShops.findFirst({
    where: { id: shopId },
    select: SHOP_SELECT,
  });
  return row ? toShop(row) : null;
}

// "Not now": keeps the current policy this time. False when it was already answered.
export async function declineShop(
  userId: string,
  shopId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<boolean> {
  const { count } = await scopedFor(userId, client).insuranceShops.updateMany({
    where: { id: shopId, status: "open" },
    data: { status: "declined", answeredAt: now },
  });
  if (count > 0) await track(userId, "insurance_shop_declined");
  return count > 0;
}

// What Jane's open reshops of the person's car and home cover would save in a year: the same
// saving the switch card and the chat's quotes show. Zero when there are none (the brief then
// says its estimate is only an estimate).
export async function openShopSavingCents(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<number> {
  const shops = (await openShops(userId, { client, now })).filter(
    (s) => s.pick && (s.savingCents ?? 0) > 0,
  );
  if (shops.length === 0) return 0;
  const kinds = new Map(
    (
      await scopedFor(userId, client).insurancePolicies.findMany({
        where: { id: { in: shops.map((s) => s.policyId) } },
        select: { id: true, kind: true },
      })
    ).map((p) => [p.id, p.kind]),
  );
  return shops
    .filter((s) => ["auto", "home", "renters"].includes(kinds.get(s.policyId) ?? ""))
    .reduce((sum, s) => sum + (s.savingCents ?? 0), 0);
}
