import { SAVEONPHONE } from "@/config/saveonphone";
import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { systemDb } from "@/lib/system-db";

// SaveOnPhone's public phone-plan catalog (src/config/saveonphone.ts) as options Jane may compare a
// phone bill against: each plan is staged in switch_options as a plan for "phone", unreviewed, so it's
// compared only after the team checks it on /admin/options, like any option. Nobody's data goes to
// SaveOnPhone: the search is by price alone. A plan already staged is updated in place by its
// SaveOnPhone page; a changed price or term clears its review.

const WHY = "Provider options are shared reference data, no one's own";

// The fields Jane reads from POST /api/v1/plans/search (its response, as returned on 2026-11-19; the
// OpenAPI leaves it untyped).
export type SaveOnPhonePlan = {
  plan_id?: number;
  carrier?: string | null;
  name?: string | null;
  network?: string | null;
  data_gb?: number | null;
  unlimited?: boolean | null;
  catalog_verified_at?: string | null;
  saveonphone_url?: string | null;
  carrier_url?: string | null;
  affiliate_url?: string | null;
  billing?: {
    initial_months?: number | null;
    initial_total_cents?: number | null;
    renewal_months?: number | null;
    renewal_total_cents?: number | null;
    activation_fee_cents?: number | null;
    taxes?: string | null;
  } | null;
  eligibility?: { requires_autopay?: boolean | null; new_customers_only?: boolean | null } | null;
  catalog?: { prepay_months?: number | null; contract?: boolean | null } | null;
};

export type StagedPlan = {
  provider: string;
  name: string;
  monthlyCents: number;
  contractMonths: number;
  oneTimeFeeCents: number;
  includes: string;
  givesUp: string;
  signUpUrl: string | null;
  sourceUrl: string;
  checkedAt: string;
};

const https = (url: unknown, host?: string): string | null => {
  if (typeof url !== "string") return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" && (!host || u.hostname === host) ? u.toString() : null;
  } catch {
    return null;
  }
};
const whole = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null);
const perMonth = (total: unknown, months: unknown) => {
  const t = whole(total);
  const m = whole(months);
  return t !== null && m ? Math.round(t / m) : null;
};

// One plan as an option, or null when it lacks a price, a source or a date. The price is the higher of
// the first term's and the renewal's a month, so a new-customer price never reads as the lasting one.
export function stagedPlan(plan: SaveOnPhonePlan): StagedPlan | null {
  const provider = plan.carrier?.trim();
  const name = plan.name?.trim();
  const sourceUrl = https(plan.saveonphone_url, "saveonphone.com");
  const checkedAt = plan.catalog_verified_at;
  const b = plan.billing ?? {};
  const prices = [
    perMonth(b.initial_total_cents, b.initial_months),
    perMonth(b.renewal_total_cents, b.renewal_months),
  ].filter((p): p is number => p !== null);
  if (!provider || !name || !sourceUrl || !prices.length) return null;
  if (typeof checkedAt !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(checkedAt)) return null;
  const prepay = whole(plan.catalog?.prepay_months) ?? 0;
  const data = plan.unlimited
    ? "Unlimited data"
    : whole(plan.data_gb) !== null
      ? `${plan.data_gb} GB of data`
      : null;
  const givesUp = [
    plan.eligibility?.new_customers_only ? "New customers only" : null,
    plan.eligibility?.requires_autopay ? "Needs autopay" : null,
    prepay > 1 ? `Paid ${prepay} months up front` : null,
    b.taxes === "excluded" ? "Taxes and fees on top" : null,
    "Check coverage and your phone first",
  ].filter(Boolean);
  // The carrier's own page, never SaveOnPhone's affiliate link.
  const carrier = https(plan.carrier_url);
  return {
    provider: provider.slice(0, 100),
    name: name.slice(0, 100),
    monthlyCents: Math.max(...prices),
    contractMonths: plan.catalog?.contract ? Math.max(prepay, 1) : prepay > 1 ? prepay : 0,
    oneTimeFeeCents: whole(b.activation_fee_cents) ?? 0,
    includes: [data, plan.network ? `${plan.network} network` : null].filter(Boolean).join(", "),
    givesUp: givesUp.join(". "),
    signUpUrl: carrier && !carrier.includes("saveonphone.com") ? carrier : null,
    sourceUrl,
    checkedAt,
  };
}

type Options = { client?: PrismaClient; fetch?: typeof fetch };

export async function searchSaveOnPhone({ fetch: send = fetch }: Options = {}): Promise<
  SaveOnPhonePlan[]
> {
  const plans: SaveOnPhonePlan[] = [];
  for (let page = 0; page < SAVEONPHONE.maxPages; page += 1) {
    const response = await send(SAVEONPHONE.searchUrl, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        max_monthly_cents: SAVEONPHONE.maxMonthlyCents,
        verified_only: SAVEONPHONE.verifiedOnly,
        limit: SAVEONPHONE.pageSize,
        offset: page * SAVEONPHONE.pageSize,
      }),
    });
    if (response.status === 429) break;
    const body = (await response.json().catch(() => null)) as {
      plans?: unknown;
      next_offset?: unknown;
    } | null;
    if (!response.ok || !Array.isArray(body?.plans)) {
      throw new Error(`SaveOnPhone search failed (HTTP ${response.status})`);
    }
    plans.push(...(body.plans as SaveOnPhonePlan[]));
    if (typeof body.next_offset !== "number" || body.plans.length < SAVEONPHONE.pageSize) break;
  }
  return plans;
}

// Stages what SaveOnPhone lists. Returns how many were added and updated.
export async function stageSaveOnPhonePlans({
  client = defaultClient,
  fetch: send = fetch,
}: Options = {}): Promise<{ added: number; updated: number }> {
  const db = systemDb(WHY, client).switchOption;
  let added = 0;
  let updated = 0;
  for (const plan of (await searchSaveOnPhone({ fetch: send })).map(stagedPlan)) {
    if (!plan) continue;
    const row = {
      kind: "plan",
      category: "phone",
      provider: plan.provider,
      name: plan.name,
      monthlyCents: plan.monthlyCents,
      contractMonths: plan.contractMonths,
      oneTimeFeeCents: plan.oneTimeFeeCents,
      includes: plan.includes,
      givesUp: plan.givesUp,
      signUpUrl: plan.signUpUrl,
      sourceUrl: plan.sourceUrl,
      checkedAt: new Date(`${plan.checkedAt}T00:00:00Z`),
    };
    const existing = await db.findFirst({
      where: { sourceUrl: plan.sourceUrl, demo: false },
      select: { id: true, monthlyCents: true, contractMonths: true, oneTimeFeeCents: true },
    });
    if (!existing) {
      await db.create({ data: { ...row, reviewedAt: null, demo: false } });
      added += 1;
      continue;
    }
    const changed =
      existing.monthlyCents !== plan.monthlyCents ||
      existing.contractMonths !== plan.contractMonths ||
      existing.oneTimeFeeCents !== plan.oneTimeFeeCents;
    await db.update({
      where: { id: existing.id },
      data: { ...row, ...(changed ? { reviewedAt: null } : {}) },
    });
    updated += 1;
  }
  return { added, updated };
}
