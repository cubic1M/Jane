import {
  IMPROVEMENT_CATEGORIES,
  IMPROVEMENT_MIN_CENTS,
  PROPERTY_TAX_PAYEE,
} from "@/config/home-taxes";
import { ENERGY_PAYEE } from "@/config/tax";
import type { PrismaClient } from "@/generated/prisma/client";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { loadTaxDocuments } from "@/lib/tax-documents";
import { loadTaxEstimate, type TaxEstimateView } from "@/lib/tax-estimate";
import { homeTaxes, type HomeTaxes } from "@/planning/home-taxes";

// Homeowner taxes (spec step 170), loaded from the person's own accounts: the mortgage
// (its 1098 when Jane collected one that checks out, step 166; else what the bank reports),
// property tax payments, energy work paid for, possible improvements, and what they told
// Jane about points and a sale. Every figure keeps where it came from.

type Options = { client?: PrismaClient; now?: Date };

export class HomeTaxesError extends Error {}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const payeeOf = (t: { merchantName: string | null; description: string }) =>
  (t.merchantName ?? t.description).trim();
const UNCAPPED = /\b(?:SOLAR|SUNRUN|SUNPOWER|SUNNOVA|TESLA ENERGY|POWERWALL|GEOTHERMAL)\b/i;

export type HomeTaxesView = HomeTaxes & {
  year: number;
  // Has a home: a mortgage, property tax, or a sale on the profile.
  homeowner: boolean;
};

export async function loadHomeTaxes(
  userId: string,
  {
    client = defaultClient,
    now = new Date(),
    loaded,
  }: Options & { loaded?: { estimate: TaxEstimateView } } = {},
): Promise<HomeTaxesView> {
  const estimate = loaded?.estimate ?? (await loadTaxEstimate(userId, { client, now }));
  const year = estimate.year;
  const db = scopedFor(userId, client);
  const [loans, spending, documents, profile] = await Promise.all([
    db.liabilities.findMany({
      where: { kind: "mortgage" },
      select: {
        ytdInterestPaidCents: true,
        account: { select: { name: true, currentBalanceCents: true } },
      },
      orderBy: [{ account: { name: "asc" } }, { id: "asc" }],
    }),
    db.transactions.findMany({
      where: {
        pending: false,
        amountCents: { gt: 0 },
        OR: [
          { pfcDetailed: "GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT" },
          { pfcDetailed: { in: [...IMPROVEMENT_CATEGORIES] } },
          { pfcDetailed: { startsWith: "HOME_IMPROVEMENT" } },
        ],
      },
      select: {
        id: true,
        date: true,
        amountCents: true,
        description: true,
        merchantName: true,
        pfcDetailed: true,
      },
      orderBy: [{ date: "asc" }, { id: "asc" }],
    }),
    loadTaxDocuments(userId, year, { client, now }),
    db.taxProfiles.findFirst({
      select: {
        homeOfficeSqFt: true,
        pointsCents: true,
        pointsYear: true,
        pointsPurchase: true,
        pointsLoanYears: true,
        homeBoughtOn: true,
        homePriceCents: true,
        homeSoldOn: true,
        homeSaleCents: true,
        homeSaleCostsCents: true,
        homeDaysLivedIn: true,
      },
    }),
  ]);
  const rows = spending.map((t) => ({ ...t, date: iso(t.date), payee: payeeOf(t) }));
  const inYear = rows.filter((t) => t.date.startsWith(String(year)));
  const mortgage = loans[0] ?? null;
  const form1098 = documents.forms.find((f) => f.formKey === "mortgage" && f.document && f.usable);
  const sale =
    profile?.homeBoughtOn &&
    profile.homePriceCents !== null &&
    profile.homeSoldOn &&
    profile.homeSaleCents !== null
      ? {
          boughtOn: iso(profile.homeBoughtOn),
          priceCents: profile.homePriceCents,
          soldOn: iso(profile.homeSoldOn),
          saleCents: profile.homeSaleCents,
          costsCents: profile.homeSaleCostsCents ?? 0,
          improvements: rows
            .filter(
              (t) =>
                (IMPROVEMENT_CATEGORIES as readonly string[]).includes(t.pfcDetailed ?? "") &&
                t.amountCents >= IMPROVEMENT_MIN_CENTS &&
                t.date >= iso(profile.homeBoughtOn!) &&
                t.date <= iso(profile.homeSoldOn!),
            )
            .map((t) => ({ id: t.id, date: t.date, payee: t.payee, cents: t.amountCents })),
          daysLivedIn: profile.homeDaysLivedIn ?? 0,
        }
      : null;

  const taxes = homeTaxes({
    year,
    status: estimate.input.filingStatus,
    agiCents: estimate.estimate.agiCents,
    mortgage: mortgage
      ? {
          name: mortgage.account.name,
          ytdInterestCents: mortgage.ytdInterestPaidCents,
          balanceCents: mortgage.account.currentBalanceCents,
          form1098: form1098
            ? {
                key: form1098.key,
                from: form1098.from,
                cents: form1098.document!.boxes.interest ?? 0,
                points: form1098.document!.boxes.points ?? 0,
              }
            : null,
        }
      : null,
    propertyTax: inYear
      .filter(
        (t) =>
          t.pfcDetailed === "GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT" &&
          PROPERTY_TAX_PAYEE.test(`${t.description} ${t.merchantName ?? ""}`),
      )
      .map((t) => ({ id: t.id, date: t.date, payee: t.payee, cents: t.amountCents })),
    stateIncomeTaxCents: estimate.input.stateWithheldCents + estimate.input.stateEstimatedPaidCents,
    points:
      profile?.pointsCents && profile.pointsYear === year
        ? {
            cents: profile.pointsCents,
            purchase: profile.pointsPurchase ?? true,
            loanYears: profile.pointsLoanYears ?? 30,
          }
        : null,
    homeOfficeSqFt: profile?.homeOfficeSqFt ?? null,
    energy: inYear
      .filter((t) => t.pfcDetailed?.startsWith("HOME_IMPROVEMENT") && ENERGY_PAYEE.test(t.payee))
      .map((t) => ({
        id: t.id,
        date: t.date,
        payee: t.payee,
        cents: t.amountCents,
        uncapped: UNCAPPED.test(t.payee),
      })),
    sale,
  });
  return {
    ...taxes,
    year,
    homeowner: Boolean(taxes.mortgageInterest || taxes.propertyTax || taxes.sale),
  };
}

export type HomeAnswers = {
  points: { cents: number; year: number; purchase: boolean; loanYears: number } | null;
  sale: {
    boughtOn: string;
    priceCents: number;
    soldOn: string;
    saleCents: number;
    costsCents: number;
    daysLivedIn: number;
  } | null;
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;

// Points and a home sale, as the person gave them. Checked here, whatever the page sent.
export async function saveHomeAnswers(
  userId: string,
  answers: HomeAnswers,
  { client = defaultClient, now = new Date(), via }: Options & { via: "chat" | "page" },
): Promise<void> {
  const money = (n: number) => Number.isInteger(n) && n >= 0;
  const p = answers.points;
  if (
    p &&
    (!money(p.cents) ||
      !Number.isInteger(p.year) ||
      !Number.isInteger(p.loanYears) ||
      p.loanYears < 1)
  ) {
    throw new HomeTaxesError("Give the points in dollars, the year paid and the loan's years.");
  }
  const s = answers.sale;
  if (s) {
    if (!DATE.test(s.boughtOn) || !DATE.test(s.soldOn)) {
      throw new HomeTaxesError("Give the dates you bought and sold.");
    }
    if (s.soldOn < s.boughtOn) throw new HomeTaxesError("The sale is before the purchase.");
    if (s.soldOn > iso(now)) throw new HomeTaxesError("The sale date can't be in the future.");
    if (![s.priceCents, s.saleCents, s.costsCents].every(money)) {
      throw new HomeTaxesError("Amounts must be dollars and cents, none below zero.");
    }
    if (!Number.isInteger(s.daysLivedIn) || s.daysLivedIn < 0 || s.daysLivedIn > 1827) {
      throw new HomeTaxesError("Days lived in it must be 0 to 1,827 (five years).");
    }
  }
  const at = (d: string) => new Date(`${d}T00:00:00Z`);
  const data = {
    pointsCents: p?.cents ?? null,
    pointsYear: p?.year ?? null,
    pointsPurchase: p?.purchase ?? null,
    pointsLoanYears: p?.loanYears ?? null,
    homeBoughtOn: s ? at(s.boughtOn) : null,
    homePriceCents: s?.priceCents ?? null,
    homeSoldOn: s ? at(s.soldOn) : null,
    homeSaleCents: s?.saleCents ?? null,
    homeSaleCostsCents: s?.costsCents ?? null,
    homeDaysLivedIn: s?.daysLivedIn ?? null,
  };
  await scopedFor(userId, client).taxProfiles.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  });
  await logAudit(
    { type: "user", id: userId },
    "tax_profile_changed",
    { type: "user", id: userId },
    { fields: "home", via },
  );
  await track(userId, "tax_profile_answered", { fields: "home", via });
}
