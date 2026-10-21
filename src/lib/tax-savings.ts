import { debtFirst } from "@/lib/debt-first";
import { ENERGY_PAYEE, TUITION_PAYEE } from "@/config/tax";
import type { PrismaClient } from "@/generated/prisma/client";
import { adviceMode } from "@/lib/advice-mode";
import { track } from "@/lib/analytics";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { loadTaxEstimate, type TaxEstimateView } from "@/lib/tax-estimate";
import { loadTaxTags } from "@/lib/tax-organizer";
import { findTaxSavings, type SavingKey, type TaxSaving } from "@/planning/tax-savings";
import { payeeOf } from "@/planning/tax-tags";

// The tax savings finder (spec step 122), from the same estimate, tags and accounts as
// /taxes. Demo advice: the savings are only worked out in demo advice mode; everyone else
// gets an empty list and the reason.

type Options = { client?: PrismaClient; now?: Date };

export class TaxSavingsError extends Error {}

// Plaid investment subtypes for workplace plans with pre-tax contributions.
const WORKPLACE_PLANS = [
  "401k",
  "403B",
  "457b",
  "401a",
  "profit sharing plan",
  "thrift savings plan",
];
// Solar and batteries (25D) have no cap; the rest (25C) do.
// Savings that mean putting more money into a tax-favoured account.
const DEBT_FIRST_KEYS: SavingKey[] = ["retirement", "ira", "hsa", "health_fsa"];
const UNCAPPED = /\b(?:SOLAR|SUNRUN|SUNPOWER|SUNNOVA|POWERWALL|GEOTHERMAL)\b/i;

export type TaxSavingsView = {
  year: number;
  advice: boolean;
  savings: TaxSaving[];
  estimate: TaxEstimateView;
};

export async function loadTaxSavings(
  userId: string,
  {
    client = defaultClient,
    now = new Date(),
    loaded,
  }: Options & { loaded?: { estimate: TaxEstimateView; advice: boolean } } = {},
): Promise<TaxSavingsView> {
  const [estimate, advice] = loaded
    ? [loaded.estimate, loaded.advice]
    : await Promise.all([loadTaxEstimate(userId, { client, now }), adviceMode(userId, { client })]);
  if (!advice) return { year: estimate.year, advice, savings: [], estimate };
  const year = estimate.year;
  const db = scopedFor(userId, client);
  const [accounts, tags, energy, profile, stressed] = await Promise.all([
    db.accounts.findMany({ select: { subtype: true } }),
    loadTaxTags(userId, year, { client }),
    db.transactions.findMany({
      where: {
        pending: false,
        amountCents: { gt: 0 },
        date: { gte: new Date(Date.UTC(year - 1, 0, 1)), lt: new Date(Date.UTC(year, 0, 1)) },
      },
      select: { amountCents: true, description: true, merchantName: true },
    }),
    db.taxProfiles.findFirst({ select: { savingsDismissed: true } }),
    debtFirst(userId, client),
  ]);
  const elapsed = estimate.elapsed > 0 ? estimate.elapsed : 1;
  const pace = (cents: number) => Math.round(cents / Math.min(1, Math.max(elapsed, 1 / 12)));
  const energyByPayee = new Map<string, number>();
  for (const t of energy) {
    const payee = payeeOf(t);
    if (ENERGY_PAYEE.test(`${t.description} ${t.merchantName ?? ""}`)) {
      energyByPayee.set(payee, (energyByPayee.get(payee) ?? 0) + t.amountCents);
    }
  }
  const tuitionByPayee = new Map<string, number>();
  for (const t of tags.tagged) {
    if (t.tag === "education" && TUITION_PAYEE.test(`${t.description} ${t.merchantName ?? ""}`)) {
      tuitionByPayee.set(t.payee, (tuitionByPayee.get(t.payee) ?? 0) + t.amountCents);
    }
  }
  const stubs = estimate.pay;
  const paychecks = Math.max(1, estimate.paychecks.count);
  const dismissed = new Set(profile?.savingsDismissed ?? []);
  const savings = findTaxSavings({
    year,
    today: now.toISOString().slice(0, 10),
    input: estimate.input,
    estimate: estimate.estimate,
    pay: {
      hasPlan:
        stubs.projected.retirementCents > 0 ||
        accounts.some((a) => WORKPLACE_PLANS.includes(a.subtype ?? "")),
      projectedRetirementCents: stubs.projected.retirementCents,
      paychecksLeft: estimate.paychecks.left,
      grossPerPaycheckCents:
        stubs.source === "none" ? 0 : Math.round(stubs.soFar.grossCents / paychecks),
    },
    hasHsa: accounts.some((a) => a.subtype === "hsa"),
    medicalCents: pace(tags.totals.medical.totalCents),
    childcareCents: pace(tags.totals.childcare.totalCents),
    tuition: [...tuitionByPayee.entries()].map(([payee, cents]) => ({ payee, cents })),
    energyLastYear: [...energyByPayee.entries()].map(([payee, cents]) => ({
      payee,
      cents,
      uncapped: UNCAPPED.test(payee),
    })),
  }).filter(
    (s) =>
      !dismissed.has(`${year}:${s.key}`) &&
      // Debt first: no new deferral or contribution for someone overdrawn or paying a high rate.
      !(stressed && DEBT_FIRST_KEYS.includes(s.key)),
  );
  return { year, advice, savings, estimate };
}

// "Not for me": not suggested again this tax year.
export async function dismissSaving(
  userId: string,
  year: number,
  key: SavingKey,
  { client = defaultClient, via }: Options & { via: "chat" | "page" },
): Promise<void> {
  const db = scopedFor(userId, client);
  const profile = await db.taxProfiles.findFirst({ select: { savingsDismissed: true } });
  const list = [...new Set([...(profile?.savingsDismissed ?? []), `${year}:${key}`])];
  await db.taxProfiles.upsert({
    where: { userId },
    create: { userId, savingsDismissed: list },
    update: { savingsDismissed: list },
  });
  await track(userId, "tax_saving_dismissed", { key, via });
}
