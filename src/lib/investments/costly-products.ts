import {
  ANNUITY_TAX_NOTE,
  DEMO_ANNUITY,
  DEMO_WHOLE_LIFE,
  LIFE_INSURER_PATTERNS,
  LOW_COST_BPS,
  MIN_PREMIUM_CENTS,
  TYPICAL_SURRENDER_PCT,
  WHOLE_LIFE_NOTE,
  type ProductKind,
} from "@/config/costly-products";
import type { PrismaClient } from "@/generated/prisma/client";
import { adviceMode } from "@/lib/advice-mode";
import { logAudit } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { hasDemoBank } from "@/lib/plaid/demo";
import {
  contractYear,
  exitComparison,
  feeGap,
  surrenderByYear,
  surrenderPct,
  wholeLifeCompare,
  yearlyCost,
  type Exit,
} from "@/planning/costly-products";
import { loadFees } from "./fees";

// What costly products really cost (spec step 215, demo advice), for its page, Jane's
// answers and her tool. Variable annuities and whole life are found from the person's
// payments (asked about once) or entered by them; advisory accounts are read from the fee
// transactions. Always the yearly cost in dollars, the surrender charge and when it ends,
// and what the same money would do in a low-cost fund as a range. Jane never says "leave"
// without the surrender figures, and recommends nothing on real accounts.

type Options = { client?: PrismaClient; now?: Date };

export class CostlyProductError extends Error {}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const DAY_MS = 86_400_000;

export type ProductView = {
  id: string;
  kind: ProductKind;
  name: string;
  provider: string;
  status: string;
  source: string;
  valueCents: number;
  yearlyCostCents: number | null;
  feeBps: number | null;
  gap: ReturnType<typeof feeGap> | null;
  surrender: {
    pctNow: number;
    cents: number;
    endsOn: string;
    byYear: ReturnType<typeof surrenderByYear>;
  } | null;
  exit: Exit | null;
  wholeLife: ReturnType<typeof wholeLifeCompare> | null;
  note: string | null;
  premiumYearlyCents: number;
};

export type AdvisoryView = {
  yearlyCents: number;
  assetsCents: number;
  feeBps: number;
  lowCostYearlyCents: number;
  gap: ReturnType<typeof feeGap>;
};

export type CostlyProductsView = {
  advice: boolean;
  demo: boolean;
  products: ProductView[];
  asked: { id: string; provider: string; yearlyCents: number }[];
  advisory: AdvisoryView | null;
};

const schedule = (json: unknown): number[] =>
  Array.isArray(json) ? json.filter((n): n is number => typeof n === "number") : [];

// Premiums to a life insurer in the last 12 months: asked about once as whole life.
async function findLifePremiums(userId: string, client: PrismaClient, now: Date) {
  const db = scopedFor(userId, client);
  const rows = await db.transactions.findMany({
    where: {
      date: { gt: new Date(now.getTime() - 365 * DAY_MS), lte: now },
      amountCents: { gt: 0 },
    },
    select: { description: true, amountCents: true },
  });
  const byProvider = new Map<string, number>();
  for (const t of rows) {
    const d = t.description.toUpperCase();
    const hit = LIFE_INSURER_PATTERNS.find((p) => d.includes(p));
    if (hit) byProvider.set(hit, (byProvider.get(hit) ?? 0) + t.amountCents);
  }
  for (const [provider, cents] of byProvider) {
    if (cents < MIN_PREMIUM_CENTS) continue;
    const have = await db.costlyProducts.count({
      where: { provider: { equals: provider, mode: "insensitive" } },
    });
    if (have === 0) {
      await db.costlyProducts.create({
        data: {
          userId,
          kind: "whole_life",
          name: "Life insurance premium",
          provider,
          status: "asked",
          premiumYearlyCents: cents,
          purchasedOn: now,
          source: "payments",
        },
      });
    }
  }
}

export async function loadCostlyProducts(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<CostlyProductsView> {
  await findLifePremiums(userId, client, now);
  const db = scopedFor(userId, client);
  const today = iso(now);
  const [advice, rows, demo, fees] = await Promise.all([
    adviceMode(userId, { client }),
    db.costlyProducts.findMany({
      where: { status: { in: ["active", "asked"] } },
      orderBy: { createdAt: "asc" },
    }),
    hasDemoBank(userId, { client }),
    loadFees(userId, { client, now }),
  ]);
  const products: ProductView[] = rows
    .filter((r) => r.status === "active")
    .map((r): ProductView => {
      const sched = schedule(r.surrenderSchedule);
      const purchased = iso(r.purchasedOn);
      const year = contractYear(purchased, today);
      const pct = surrenderPct(sched, year);
      const surrender = {
        pctNow: pct,
        cents: Math.round((r.valueCents * pct) / 100),
        endsOn: exitComparison({
          valueCents: r.valueCents,
          feeBps: r.feeBps,
          schedule: sched,
          purchasedOn: purchased,
          today,
        }).surrenderEndsOn,
        byYear: surrenderByYear(r.valueCents, sched, year),
      };
      if (r.kind === "annuity") {
        return {
          id: r.id,
          kind: "annuity",
          name: r.name,
          provider: r.provider,
          status: r.status,
          source: r.source,
          valueCents: r.valueCents,
          yearlyCostCents: yearlyCost(r.valueCents, r.feeBps),
          feeBps: r.feeBps,
          gap: feeGap(r.valueCents, r.feeBps),
          surrender,
          exit: exitComparison({
            valueCents: r.valueCents,
            feeBps: r.feeBps,
            schedule: sched,
            purchasedOn: purchased,
            today,
          }),
          wholeLife: null,
          note: ANNUITY_TAX_NOTE,
          premiumYearlyCents: 0,
        };
      }
      const wl = wholeLifeCompare({
        premiumYearlyCents: r.premiumYearlyCents,
        years: Math.max(1, year - 1),
        cashValueCents: r.valueCents,
        surrenderPctNow: pct,
      });
      return {
        id: r.id,
        kind: "whole_life",
        name: r.name,
        provider: r.provider,
        status: r.status,
        source: r.source,
        valueCents: r.valueCents,
        yearlyCostCents: r.premiumYearlyCents,
        feeBps: null,
        gap: null,
        surrender,
        exit: null,
        wholeLife: wl,
        note: WHOLE_LIFE_NOTE,
        premiumYearlyCents: r.premiumYearlyCents,
      };
    });
  // Advisory accounts: the fees paid in the last 12 months against what's in the accounts
  // that paid them.
  let advisory: AdvisoryView | null = null;
  if (fees.fees.advisoryCents > 0) {
    const assets = fees.investments.accounts
      .filter((a) => a.subtype === "brokerage")
      .reduce((s, a) => s + (a.balanceCents ?? 0), 0);
    if (assets > 0) {
      const bps = Math.round((fees.fees.advisoryCents / assets) * 10_000);
      advisory = {
        yearlyCents: fees.fees.advisoryCents,
        assetsCents: assets,
        feeBps: bps,
        lowCostYearlyCents: yearlyCost(assets, LOW_COST_BPS),
        gap: feeGap(assets, bps),
      };
    }
  }
  return {
    advice,
    demo,
    products,
    asked: rows
      .filter((r) => r.status === "asked")
      .map((r) => ({ id: r.id, provider: r.provider, yearlyCents: r.premiumYearlyCents })),
    advisory,
  };
}

export async function answerPremium(
  userId: string,
  id: string,
  isWholeLife: boolean,
  { client = defaultClient }: Options = {},
) {
  const { count } = await scopedFor(userId, client).costlyProducts.updateMany({
    where: { id, status: "asked" },
    data: { status: isWholeLife ? "active" : "dismissed" },
  });
  if (count === 0) throw new CostlyProductError("That question was already answered.");
}

export type ProductForm = {
  kind: string;
  name: string;
  provider: string;
  value: string;
  feePercent: string;
  premiumYearly: string;
  purchasedYear: string;
  purchasedMonth: string;
  schedule: string;
};

const money = (s: string, label: string) => {
  if (!s.trim()) return 0;
  const n = Math.round(Number(s.replace(/[$,]/g, "")) * 100);
  if (!Number.isFinite(n) || n < 0 || n > 5_000_000_000)
    throw new CostlyProductError(`Check the ${label}.`);
  return n;
};

// The person's own contract: what they know from the statement.
export async function saveProduct(
  userId: string,
  form: ProductForm,
  { client = defaultClient, now = new Date() }: Options = {},
) {
  if (form.kind !== "annuity" && form.kind !== "whole_life")
    throw new CostlyProductError("Pick annuity or whole life.");
  const name = form.name.trim().slice(0, 60);
  const provider = form.provider.trim().slice(0, 60);
  if (!name || !provider) throw new CostlyProductError("Enter the product's name and the company.");
  const year = Math.round(Number(form.purchasedYear));
  const month = Math.round(Number(form.purchasedMonth || "1"));
  if (!(year >= 1970 && year <= now.getUTCFullYear()) || !(month >= 1 && month <= 12))
    throw new CostlyProductError("Check the month and year you bought it.");
  const fee = form.feePercent.trim() ? Math.round(Number(form.feePercent) * 100) : 0;
  if (!Number.isFinite(fee) || fee < 0 || fee > 1000)
    throw new CostlyProductError("Check the yearly fee.");
  const sched = form.schedule.trim()
    ? form.schedule.split(",").map((s) => Number(s.trim()))
    : [...TYPICAL_SURRENDER_PCT];
  if (sched.some((n) => !Number.isFinite(n) || n < 0 || n > 100) || sched.length > 20)
    throw new CostlyProductError("Enter the surrender charges as percents, like 7,6,5,4,3,2,1.");
  const db = scopedFor(userId, client);
  const row = await db.costlyProducts.create({
    data: {
      userId,
      kind: form.kind,
      name,
      provider,
      valueCents: money(form.value, "value"),
      feeBps: fee,
      premiumYearlyCents: money(form.premiumYearly, "yearly premium"),
      purchasedOn: new Date(Date.UTC(year, month - 1, 1)),
      surrenderSchedule: sched,
      source: "you",
    },
    select: { id: true },
  });
  await logAudit(
    { type: "user", id: userId },
    "costly_product_saved",
    { type: "costly_product", id: row.id },
    { kind: form.kind },
  );
}

export async function linkDemoProducts(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
) {
  if (!(await hasDemoBank(userId, { client })))
    throw new CostlyProductError("Demo products need the demo bank.");
  const db = scopedFor(userId, client);
  if ((await db.costlyProducts.count({ where: { source: "demo" } })) > 0) return;
  const ago = (years: number) =>
    new Date(Date.UTC(now.getUTCFullYear() - years, now.getUTCMonth(), 1));
  await db.costlyProducts.create({
    data: {
      userId,
      kind: "annuity",
      name: DEMO_ANNUITY.name,
      provider: DEMO_ANNUITY.provider,
      valueCents: DEMO_ANNUITY.valueCents,
      feeBps: DEMO_ANNUITY.feeBps,
      purchasedOn: ago(DEMO_ANNUITY.yearsAgo),
      surrenderSchedule: [...DEMO_ANNUITY.schedule],
      source: "demo",
    },
  });
  await db.costlyProducts.create({
    data: {
      userId,
      kind: "whole_life",
      name: DEMO_WHOLE_LIFE.name,
      provider: DEMO_WHOLE_LIFE.provider,
      valueCents: DEMO_WHOLE_LIFE.cashValueCents,
      premiumYearlyCents: DEMO_WHOLE_LIFE.premiumYearlyCents,
      purchasedOn: ago(DEMO_WHOLE_LIFE.yearsAgo),
      surrenderSchedule: [...DEMO_WHOLE_LIFE.schedule],
      source: "demo",
    },
  });
  await logAudit(
    { type: "user", id: userId },
    "costly_product_saved",
    { type: "user", id: userId },
    { demo: true },
  );
}
