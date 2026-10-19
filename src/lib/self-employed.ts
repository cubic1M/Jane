import {
  INCOME_KINDS,
  MAX_BUSINESS_MILES,
  MAX_HOME_OFFICE_SQFT,
  SET_ASIDE_RECENT_DAYS,
} from "@/config/tax";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { adviceMode } from "@/lib/advice-mode";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import {
  loadTaxEstimate,
  parseTaxPayments,
  type EnteredTaxPayment,
  type TaxEstimateView,
} from "@/lib/tax-estimate";
import {
  homeOfficeDeduction,
  mileageDeduction,
  quarterlyPlan,
  setAsideRate,
  type QuarterlyPlan,
} from "@/planning/self-employed";
import { loadTaxTags } from "@/lib/tax-organizer";
import { estimateTaxes } from "@/planning/tax-estimate";
import { estimatedTaxDates } from "@/planning/tax-pack";
import { payeeOf } from "@/planning/tax-tags";

// Freelancers' taxes (spec step 123), from the same estimate as /taxes: business expenses
// (tagged), the home office and mileage helpers, what to set aside from each payment and the
// quarterly estimated payments, each reminded before its due date. The set-aside and the
// quarterly amounts are demo advice: real accounts get the dates and the helpers.

type Options = { client?: PrismaClient; now?: Date };

export class SelfEmployedError extends Error {}

export type SelfEmployedView = {
  year: number;
  // Freelance or gig income this year (or on the profile).
  active: boolean;
  advice: boolean;
  estimate: TaxEstimateView;
  // Money in from freelance work so far this year.
  freelanceInCents: number;
  businessCents: number;
  homeOffice: { sqft: number | null; deductionCents: number };
  mileage: { miles: number; deductionCents: number };
  // Share of each payment to set aside (0–0.5).
  setAsideRate: number;
  federal: QuarterlyPlan;
  state: QuarterlyPlan | null;
  // Freelance payments in the last SET_ASIDE_RECENT_DAYS days, with what to set aside.
  recent: { id: string; date: string; payer: string; cents: number; setAsideCents: number }[];
  payments: EnteredTaxPayment[];
  // A "Taxes set aside" goal for the year exists.
  setAsideGoal: boolean;
};

const iso = (d: Date) => d.toISOString().slice(0, 10);
const total = (e: ReturnType<typeof estimateTaxes>) => e.totalTaxCents + (e.state?.taxCents ?? 0);

export async function loadSelfEmployed(
  userId: string,
  {
    client = defaultClient,
    now = new Date(),
    loaded,
  }: Options & { loaded?: { estimate: TaxEstimateView; advice: boolean } } = {},
): Promise<SelfEmployedView> {
  const [estimate, advice] = loaded
    ? [loaded.estimate, loaded.advice]
    : await Promise.all([loadTaxEstimate(userId, { client, now }), adviceMode(userId, { client })]);
  const year = estimate.year;
  const today = iso(now);
  const db = scopedFor(userId, client);
  const [freelance, profile, business] = await Promise.all([
    db.transactions.findMany({
      where: {
        pending: false,
        amountCents: { lt: 0 },
        pfcDetailed: { in: [...INCOME_KINDS.self_employed.categories] },
        date: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) },
      },
      select: { id: true, date: true, amountCents: true, description: true, merchantName: true },
      orderBy: [{ date: "desc" }, { id: "asc" }],
    }),
    db.taxProfiles.findFirst({
      select: {
        incomeKinds: true,
        homeOfficeSqFt: true,
        businessMiles: true,
        businessMilesYear: true,
        taxPayments: true,
      },
    }),
    loadTaxTags(userId, year, { client }),
  ]);
  const setAsideGoal =
    (await db.savingsGoals.count({ where: { name: `Taxes set aside for ${year}` } })) > 0;
  const freelanceIn = freelance.reduce((s, t) => s - t.amountCents, 0);
  const active = freelanceIn > 0 || (profile?.incomeKinds.includes("self_employed") ?? false);

  // The tax freelance income adds, from running the estimate without it.
  const input = estimate.input;
  const without = estimateTaxes({ ...input, income: { ...input.income, selfEmploymentCents: 0 } });
  const elapsed = estimate.elapsed > 0 ? estimate.elapsed : 1;
  const freelanceYear = Math.round(freelanceIn / Math.min(1, elapsed));
  const rate = setAsideRate({
    taxWithCents: total(estimate.estimate),
    taxWithoutCents: total(without),
    freelanceInCents: freelanceYear,
  });

  const e = estimate.estimate;
  const dueDates = estimatedTaxDates(year);
  const withheld = estimate.pay.projected.federalWithheldCents;
  const federal = quarterlyPlan({
    dueDates,
    today,
    totalTaxCents: e.totalTaxCents,
    withheldCents: withheld,
    paidCents: input.federalEstimatedPaidCents,
  });
  const state =
    e.state && e.state.kind !== "none"
      ? quarterlyPlan({
          dueDates,
          today,
          totalTaxCents: e.state.taxCents,
          withheldCents: estimate.pay.projected.stateWithheldCents,
          paidCents: input.stateEstimatedPaidCents,
        })
      : null;

  const since = iso(new Date(now.getTime() - SET_ASIDE_RECENT_DAYS * 86_400_000));
  const miles = profile?.businessMilesYear === year ? (profile.businessMiles ?? 0) : 0;
  return {
    year,
    active,
    advice,
    estimate,
    freelanceInCents: freelanceIn,
    businessCents: business.totals.business.totalCents,
    homeOffice: {
      sqft: profile?.homeOfficeSqFt ?? null,
      deductionCents: homeOfficeDeduction(profile?.homeOfficeSqFt ?? null),
    },
    mileage: { miles, deductionCents: mileageDeduction(miles) },
    setAsideRate: rate,
    federal,
    state,
    recent: freelance
      .map((t) => ({ ...t, date: iso(t.date) }))
      .filter((t) => t.date >= since)
      .map((t) => ({
        id: t.id,
        date: t.date,
        payer: payeeOf(t),
        cents: -t.amountCents,
        setAsideCents: Math.round(-t.amountCents * rate),
      })),
    payments: parseTaxPayments(profile?.taxPayments),
    setAsideGoal,
  };
}

async function audit(userId: string, fields: string, via: "chat" | "page") {
  await logAudit(
    { type: "user", id: userId },
    "tax_profile_changed",
    { type: "user", id: userId },
    { fields, via },
  );
}

// The home office, in square feet (simplified method); null clears it.
export async function saveHomeOffice(
  userId: string,
  sqft: number | null,
  { client = defaultClient, via }: Options & { via: "chat" | "page" },
): Promise<void> {
  if (sqft !== null && (!Number.isInteger(sqft) || sqft <= 0 || sqft > MAX_HOME_OFFICE_SQFT * 10)) {
    throw new SelfEmployedError("Give the office's size in whole square feet.");
  }
  await scopedFor(userId, client).taxProfiles.upsert({
    where: { userId },
    create: { userId, homeOfficeSqFt: sqft },
    update: { homeOfficeSqFt: sqft },
  });
  await audit(userId, "homeOffice", via);
}

// Business miles driven so far this year: set, or add to.
export async function saveMiles(
  userId: string,
  miles: number,
  {
    client = defaultClient,
    now = new Date(),
    via,
    add = false,
  }: Options & { via: "chat" | "page"; add?: boolean },
): Promise<number> {
  if (!Number.isInteger(miles) || miles < 0 || miles > MAX_BUSINESS_MILES) {
    throw new SelfEmployedError("Give the miles as a whole number.");
  }
  const year = now.getUTCFullYear();
  const db = scopedFor(userId, client);
  const current = await db.taxProfiles.findFirst({
    select: { businessMiles: true, businessMilesYear: true },
  });
  const sofar = current?.businessMilesYear === year ? (current.businessMiles ?? 0) : 0;
  const next = Math.min(MAX_BUSINESS_MILES, add ? sofar + miles : miles);
  await db.taxProfiles.upsert({
    where: { userId },
    create: { userId, businessMiles: next, businessMilesYear: year },
    update: { businessMiles: next, businessMilesYear: year },
  });
  await audit(userId, "businessMiles", via);
  return next;
}

// An estimated tax payment the person made from an account Jane can't see.
export async function recordTaxPayment(
  userId: string,
  payment: EnteredTaxPayment,
  { client = defaultClient, now = new Date(), via }: Options & { via: "chat" | "page" },
): Promise<void> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(payment.date) || payment.date > iso(now)) {
    throw new SelfEmployedError("Give the day you paid, today or before.");
  }
  if (!Number.isInteger(payment.cents) || payment.cents <= 0) {
    throw new SelfEmployedError("Give the amount you paid.");
  }
  if (payment.to !== "federal" && payment.to !== "state")
    throw new SelfEmployedError("Federal or state?");
  const db = scopedFor(userId, client);
  const current = await db.taxProfiles.findFirst({ select: { taxPayments: true } });
  const list = [
    ...parseTaxPayments(current?.taxPayments),
    payment,
  ] as unknown as Prisma.InputJsonArray;
  await db.taxProfiles.upsert({
    where: { userId },
    create: { userId, taxPayments: list },
    update: { taxPayments: list },
  });
  await audit(userId, "taxPayments", via);
  await track(userId, "tax_payment_recorded", { to: payment.to, via });
}
