import { INCOME_KINDS } from "@/config/tax";
import { SIDE_INCOME_MIN_CENTS } from "@/config/side-income";
import type { PrismaClient } from "@/generated/prisma/client";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { loadTaxDocuments } from "@/lib/tax-documents";
import { loadTaxEstimate, type TaxEstimateView } from "@/lib/tax-estimate";
import { loadTaxTags } from "@/lib/tax-organizer";
import { estimateTaxes } from "@/planning/tax-estimate";
import {
  matchPlatform,
  rentalDepreciation,
  rentalNet,
  type Depreciation,
  type PlatformMatch,
  type RentalNet,
} from "@/planning/side-income";

// Side income and rentals (spec step 173), from the person's own accounts: rent in less the
// expenses they tagged and the depreciation on the property; gig platforms' payouts matched
// to their 1099s (the forms Jane collected, step 166, checked against the same payouts);
// and hobby or business, side by side. All of it is already in the estimate, the quarterly
// amounts and the tax-time pack.

type Options = { client?: PrismaClient; now?: Date };

export class SideIncomeError extends Error {}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const payerOf = (t: { merchantName: string | null; description: string }) =>
  (t.merchantName ?? t.description).trim();

export type Platform = {
  payer: string;
  payoutsCents: number;
  payouts: { id: string; date: string; cents: number }[];
  formCents: number | null;
  formKey: string | null;
  status: PlatformMatch;
};

export type SideIncomeView = {
  year: number;
  rental:
    | (RentalNet & {
        depreciation: Depreciation | null;
        rentRows: { id: string; date: string; payer: string; cents: number }[];
        expenseRows: { id: string; date: string; payee: string; cents: number }[];
        priceCents: number | null;
        placedOn: string | null;
      })
    | null;
  platforms: Platform[];
  gigCents: number;
  // Said by the person; null if not.
  kind: "business" | "hobby" | null;
  // Tax both ways, when there's freelance or gig income to choose about.
  bothWays: { business: number; hobby: number } | null;
};

export async function loadSideIncome(
  userId: string,
  {
    client = defaultClient,
    now = new Date(),
    loaded,
  }: Options & { loaded?: { estimate: TaxEstimateView } } = {},
): Promise<SideIncomeView> {
  const estimate = loaded?.estimate ?? (await loadTaxEstimate(userId, { client, now }));
  const year = estimate.year;
  const db = scopedFor(userId, client);
  const start = new Date(Date.UTC(year, 0, 1));
  const end = new Date(Date.UTC(year + 1, 0, 1));
  const [income, tags, docs, profile] = await Promise.all([
    db.transactions.findMany({
      where: {
        pending: false,
        amountCents: { lt: 0 },
        date: { gte: start, lt: end },
        pfcDetailed: {
          in: [...INCOME_KINDS.rental.categories, ...INCOME_KINDS.self_employed.categories],
        },
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
    loadTaxTags(userId, year, { client }),
    loadTaxDocuments(userId, year, { client, now }),
    db.taxProfiles.findFirst({
      select: { rentalPriceCents: true, rentalPlacedOn: true, sideIncomeKind: true },
    }),
  ]);
  const rentRows = income
    .filter((t) =>
      (INCOME_KINDS.rental.categories as readonly string[]).includes(t.pfcDetailed ?? ""),
    )
    .map((t) => ({ id: t.id, date: iso(t.date), payer: payerOf(t), cents: -t.amountCents }));
  const expenseRows = tags.tagged
    .filter((t) => t.tag === "rental")
    .map((t) => ({ id: t.id, date: t.date, payee: t.payee, cents: t.amountCents }));
  const priceCents = profile?.rentalPriceCents ?? null;
  const placedOn = profile?.rentalPlacedOn ? iso(profile.rentalPlacedOn) : null;
  const depreciation =
    priceCents && placedOn ? rentalDepreciation({ year, priceCents, placedOn }) : null;
  const rentTotal = rentRows.reduce((s, r) => s + r.cents, 0);
  const expenses = expenseRows.reduce((s, r) => s + r.cents, 0);
  const net = rentalNet({
    rentCents: rentTotal,
    expensesCents: expenses,
    depreciationCents: depreciation?.cents ?? 0,
    otherIncomeCents: estimate.input.income.wagesCents,
  });

  // Gig platforms: each payer's payouts, and the 1099 collected for it.
  const gig = income.filter((t) =>
    (INCOME_KINDS.self_employed.categories as readonly string[]).includes(t.pfcDetailed ?? ""),
  );
  const byPayer = new Map<string, Platform["payouts"]>();
  for (const t of gig) {
    const list = byPayer.get(payerOf(t)) ?? [];
    list.push({ id: t.id, date: iso(t.date), cents: -t.amountCents });
    byPayer.set(payerOf(t), list);
  }
  const platforms: Platform[] = [...byPayer.entries()]
    .map(([payer, payouts]) => {
      const form = docs.forms.find((f) => f.formKey === "nec" && f.from === payer);
      const payoutsCents = payouts.reduce((s, p) => s + p.cents, 0);
      return {
        payer,
        payoutsCents,
        payouts,
        formCents: form?.document ? (form.check?.formCents ?? null) : null,
        formKey: form?.key ?? null,
        status: matchPlatform({
          payoutsCents,
          formCents: form?.document ? (form.check?.formCents ?? null) : null,
          checkStatus: form?.check?.status ?? null,
          mayNotSend: form?.mayNotSend ?? false,
        }),
      };
    })
    .sort((a, b) => b.payoutsCents - a.payoutsCents || a.payer.localeCompare(b.payer));
  const gigCents = platforms.reduce((s, p) => s + p.payoutsCents, 0);

  let bothWays: SideIncomeView["bothWays"] = null;
  if (gigCents >= SIDE_INCOME_MIN_CENTS) {
    const input = estimate.input;
    // As a business: the payouts less the business expenses tagged; as a hobby: all of it,
    // with no expenses and no self-employment tax.
    const businessExpenses = tags.totals.business.totalCents;
    const asBusiness = estimateTaxes({
      ...input,
      income: {
        ...input.income,
        otherCents: 0,
        selfEmploymentCents: Math.max(0, gigCents - businessExpenses),
      },
    }).totalTaxCents;
    const asHobby = estimateTaxes({
      ...input,
      income: { ...input.income, selfEmploymentCents: 0, otherCents: gigCents },
    }).totalTaxCents;
    bothWays = { business: asBusiness, hobby: asHobby };
  }
  const hasRental = rentRows.length > 0 || expenseRows.length > 0 || depreciation !== null;
  return {
    year,
    rental: hasRental
      ? { ...net, depreciation, rentRows, expenseRows, priceCents, placedOn }
      : null,
    platforms,
    gigCents,
    kind:
      profile?.sideIncomeKind === "hobby" || profile?.sideIncomeKind === "business"
        ? profile.sideIncomeKind
        : null,
    bothWays,
  };
}

export type SideIncomeAnswers = {
  rental: { priceCents: number; placedOn: string } | null;
  kind: "business" | "hobby" | null;
};

// The rental property and hobby-or-business, as the person gave them. Checked here.
export async function saveSideIncomeAnswers(
  userId: string,
  answers: SideIncomeAnswers,
  { client = defaultClient, now = new Date(), via }: Options & { via: "chat" | "page" },
): Promise<void> {
  const r = answers.rental;
  if (r) {
    if (!Number.isInteger(r.priceCents) || r.priceCents <= 0) {
      throw new SideIncomeError("Give the price you paid, in dollars.");
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.placedOn) || Number.isNaN(Date.parse(r.placedOn))) {
      throw new SideIncomeError("Give the date it was ready to rent.");
    }
    if (r.placedOn > iso(now)) throw new SideIncomeError("That date can't be in the future.");
  }
  const data = {
    rentalPriceCents: r?.priceCents ?? null,
    rentalPlacedOn: r ? new Date(`${r.placedOn}T00:00:00Z`) : null,
    sideIncomeKind: answers.kind,
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
    { fields: "sideIncome", via },
  );
  await track(userId, "tax_profile_answered", { fields: "sideIncome", via });
}
