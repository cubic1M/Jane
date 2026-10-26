import { DEFAULT_LAND_SHARE, DEMO_RENTAL } from "@/config/property";
import type { PrismaClient } from "@/generated/prisma/client";
import { adviceMode } from "@/lib/advice-mode";
import { logAudit } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { hasDemoBank } from "@/lib/plaid/demo";
import { loadSideIncome } from "@/lib/side-income";
import { rentalDepreciation } from "@/planning/side-income";
import {
  homeEquity,
  interestOver,
  paydownVsInvest,
  rentalFigures,
  type Paydown,
  type RentalFigures,
} from "@/planning/property";

// Property as an investment (spec step 214, demo advice), for its page, Jane's answers and
// its tool: home equity, each rental's figures from its own transactions (rent in, the
// mortgage, property tax, repairs), depreciation handed to the taxes side (step 173 reads
// rentalDepreciationFor), and whether paying the mortgage down beats investing.

type Options = { client?: PrismaClient; now?: Date };

export class PropertyError extends Error {}

const DAY_MS = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const words = (s: string) =>
  s
    .split(",")
    .map((w) => w.trim().toUpperCase())
    .filter(Boolean);
const hits = (description: string, patterns: string[]) => {
  const d = description.toUpperCase();
  return patterns.some((p) => d.includes(p));
};

export type HomeView = {
  id: string;
  name: string;
  valueCents: number;
  valuedOn: string;
  loanCents: number | null;
  equityCents: number;
  rateBps: number | null;
  paymentCents: number | null;
};

export type RentalView = {
  id: string;
  name: string;
  figures: RentalFigures;
  // The transactions each figure came from, so it can be checked.
  counts: { rent: number; mortgage: number; tax: number; other: number };
  depreciationYear: number;
  cashInvestedCents: number;
  loanBalanceCents: number;
  source: string;
};

export type PropertyView = {
  advice: boolean;
  demo: boolean;
  year: number;
  homes: HomeView[];
  rentals: RentalView[];
  // The home's mortgage: extra money put toward it against investing the same.
  paydown: (Paydown & { homeName: string; rateBps: number }) | null;
};

// Depreciation is figured once, by the taxes side (step 173): this reads its answer for
// the year, so there is a single source for it.
export async function rentalDepreciationFor(
  userId: string,
  year: number,
  { client = defaultClient }: Options = {},
) {
  const side = await loadSideIncome(userId, { client, now: new Date(Date.UTC(year, 11, 31)) });
  const d = side.rental?.depreciation;
  return d ? [{ name: "Your rental", depreciationCents: d.cents }] : [];
}

// The extra a month Jane compares for the home's mortgage.
const EXTRA_MONTHLY_CENTS = 50_000;

export async function loadProperty(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<PropertyView> {
  const db = scopedFor(userId, client);
  const year = now.getUTCFullYear();
  const since = new Date(now.getTime() - 365 * DAY_MS);
  const [advice, assets, rentals, txs, demo] = await Promise.all([
    adviceMode(userId, { client }),
    db.ownedAssets.findMany({
      where: { kind: "home" },
      select: {
        id: true,
        name: true,
        valueCents: true,
        valuedOn: true,
        loanAccount: {
          select: {
            currentBalanceCents: true,
            liability: { select: { aprBps: true, minimumPaymentCents: true } },
          },
        },
      },
    }),
    db.rentalProperties.findMany({ orderBy: { createdAt: "asc" } }),
    db.transactions.findMany({
      where: { date: { gt: since, lte: now } },
      select: { description: true, amountCents: true },
    }),
    hasDemoBank(userId, { client }),
  ]);
  const homes: HomeView[] = assets.map((a) => {
    const loan = a.loanAccount?.currentBalanceCents ?? null;
    return {
      id: a.id,
      name: a.name,
      valueCents: a.valueCents,
      valuedOn: iso(a.valuedOn),
      loanCents: loan,
      equityCents: homeEquity(a.valueCents, loan ?? 0),
      rateBps: a.loanAccount?.liability?.aprBps ?? null,
      paymentCents: a.loanAccount?.liability?.minimumPaymentCents ?? null,
    };
  });
  const rentalViews = rentals.map((r): RentalView => {
    const rent = words(r.rentMatch);
    const mortgage = words(r.mortgageMatch);
    const tax = words(r.taxMatch);
    const other = words(r.expenseMatch);
    const sum = (patterns: string[], sign: 1 | -1) => {
      const rows = patterns.length === 0 ? [] : txs.filter((t) => hits(t.description, patterns));
      return { cents: rows.reduce((s, t) => s + sign * t.amountCents, 0), n: rows.length };
    };
    const rentIn = sum(rent, -1);
    const mort = sum(mortgage, 1);
    const prop = sum(tax, 1);
    const exp = sum(other, 1);
    const interest = interestOver(
      r.loanBalanceCents,
      r.loanRateBps,
      r.monthlyPaymentCents,
      12,
    ).interestCents;
    // Step 173's depreciation for this property's price and the month it was first rented.
    const dep = rentalDepreciation({
      year,
      priceCents: r.purchaseCents,
      placedOn: `${r.placedInServiceYear}-${String(r.placedInServiceMonth).padStart(2, "0")}-01`,
      buildingShare: 1 - r.landShare,
    }).cents;
    return {
      id: r.id,
      name: r.name,
      figures: rentalFigures({
        rentCents: rentIn.cents,
        mortgagePaidCents: mort.cents,
        propertyTaxCents: prop.cents,
        otherExpensesCents: exp.cents,
        mortgageInterestCents: mort.n > 0 ? interest : 0,
        depreciationCents: dep,
        cashInvestedCents: r.cashInvestedCents,
      }),
      counts: { rent: rentIn.n, mortgage: mort.n, tax: prop.n, other: exp.n },
      depreciationYear: year,
      cashInvestedCents: r.cashInvestedCents,
      loanBalanceCents: r.loanBalanceCents,
      source: r.source,
    };
  });
  const mortgageHome = homes.find((h) => h.loanCents && h.rateBps && h.paymentCents);
  return {
    advice,
    demo,
    year,
    homes,
    rentals: rentalViews,
    paydown: mortgageHome
      ? {
          ...paydownVsInvest({
            balanceCents: mortgageHome.loanCents!,
            rateBps: mortgageHome.rateBps!,
            paymentCents: mortgageHome.paymentCents!,
            extraMonthlyCents: EXTRA_MONTHLY_CENTS,
          }),
          homeName: mortgageHome.name,
          rateBps: mortgageHome.rateBps!,
        }
      : null,
  };
}

export type RentalForm = {
  name: string;
  purchase: string;
  placedInServiceMonth: string;
  placedInServiceYear: string;
  cashInvested: string;
  loanBalance: string;
  loanRate: string;
  monthlyPayment: string;
  rentMatch: string;
  mortgageMatch: string;
  taxMatch: string;
  expenseMatch: string;
};

const money = (s: string, label: string, required = false): number => {
  if (!s.trim()) {
    if (required) throw new PropertyError(`Enter the ${label}.`);
    return 0;
  }
  const n = Math.round(Number(s.replace(/[$,]/g, "")) * 100);
  if (!Number.isFinite(n) || n < 0 || n > 5_000_000_000)
    throw new PropertyError(`Check the ${label}.`);
  return n;
};

export async function addRental(
  userId: string,
  form: RentalForm,
  { client = defaultClient }: Options = {},
) {
  const name = form.name.trim().slice(0, 60);
  if (!name) throw new PropertyError("Give the property a name.");
  const month = Math.round(Number(form.placedInServiceMonth));
  const year = Math.round(Number(form.placedInServiceYear));
  if (!(month >= 1 && month <= 12) || !(year >= 1980 && year <= new Date().getUTCFullYear()))
    throw new PropertyError("Check the month and year it was first rented.");
  if (!form.rentMatch.trim())
    throw new PropertyError("Tell me the text on the rent deposits, like TENANT RENT.");
  const rate = form.loanRate.trim() ? Math.round(Number(form.loanRate) * 100) : 0;
  if (!Number.isFinite(rate) || rate < 0 || rate > 2500)
    throw new PropertyError("Check the loan rate.");
  const row = await scopedFor(userId, client).rentalProperties.create({
    data: {
      userId,
      name,
      purchaseCents: money(form.purchase, "purchase price", true),
      landShare: DEFAULT_LAND_SHARE,
      placedInServiceYear: year,
      placedInServiceMonth: month,
      cashInvestedCents: money(form.cashInvested, "cash you put in"),
      loanBalanceCents: money(form.loanBalance, "loan balance"),
      loanRateBps: rate,
      monthlyPaymentCents: money(form.monthlyPayment, "monthly payment"),
      rentMatch: form.rentMatch.trim().slice(0, 120),
      mortgageMatch: form.mortgageMatch.trim().slice(0, 120),
      taxMatch: form.taxMatch.trim().slice(0, 120),
      expenseMatch: form.expenseMatch.trim().slice(0, 200),
    },
    select: { id: true },
  });
  await logAudit(
    { type: "user", id: userId },
    "rental_added",
    { type: "rental_property", id: row.id },
    {},
  );
}

// The demo rental: a property, and a year of its rent, mortgage, tax and repair transactions
// in the demo bank's checking account (a stand-in for the person's own bank history).
export async function linkDemoRental(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
) {
  const db = scopedFor(userId, client);
  if (!(await hasDemoBank(userId, { client })))
    throw new PropertyError("A demo rental needs the demo bank.");
  if ((await db.rentalProperties.count({ where: { source: "demo" } })) > 0) return;
  const checking = await db.accounts.findFirst({
    where: { subtype: "checking" },
    select: { id: true },
  });
  if (!checking) throw new PropertyError("Link a checking account first.");
  const d = DEMO_RENTAL;
  await db.rentalProperties.create({
    data: {
      userId,
      name: d.name,
      purchaseCents: d.purchaseCents,
      landShare: d.landShare,
      placedInServiceYear: d.placedInServiceYear,
      placedInServiceMonth: d.placedInServiceMonth,
      cashInvestedCents: d.cashInvestedCents,
      loanBalanceCents: d.loanBalanceCents,
      loanRateBps: d.loanRateBps,
      monthlyPaymentCents: d.monthlyPaymentCents,
      rentMatch: d.rentMatch,
      mortgageMatch: d.mortgageMatch,
      taxMatch: d.taxMatch,
      expenseMatch: d.expenseMatch,
      source: "demo",
    },
  });
  const rows: {
    key: string;
    date: string;
    amountCents: number;
    description: string;
    detailed: string;
    primary: string;
  }[] = [];
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  for (let m = 0; m < 12; m += 1) {
    const month = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - m, 1));
    const day = (n: number) =>
      iso(new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), n)));
    const ym = day(1).slice(0, 7);
    if (day(3) <= iso(end))
      rows.push({
        key: `rent-${ym}`,
        date: day(3),
        amountCents: -185_000,
        description: "ZELLE FROM J TENANT RENT",
        detailed: "INCOME_OTHER_INCOME",
        primary: "INCOME",
      });
    if (day(1) <= iso(end))
      rows.push({
        key: `loan-${ym}`,
        date: day(1),
        amountCents: d.monthlyPaymentCents,
        description: "MAPLE ST RENTAL LOAN PMT",
        detailed: "LOAN_PAYMENTS_MORTGAGE_PAYMENT",
        primary: "LOAN_PAYMENTS",
      });
  }
  const yearAgo = new Date(end.getTime() - 365 * DAY_MS);
  for (const [i, [mm, dd, cents, description, detailed, primary]] of (
    [
      [
        4,
        10,
        115_000,
        "COUNTY TREASURER PROPERTY TAX",
        "GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT",
        "GOVERNMENT_AND_NON_PROFIT",
      ],
      [
        10,
        10,
        115_000,
        "COUNTY TREASURER PROPERTY TAX",
        "GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT",
        "GOVERNMENT_AND_NON_PROFIT",
      ],
      [
        2,
        14,
        34_000,
        "ACE PLUMBING REPAIR",
        "HOME_IMPROVEMENT_REPAIR_AND_MAINTENANCE",
        "HOME_IMPROVEMENT",
      ],
      [6, 21, 21_200, "HOME DEPOT RENTAL REPAIRS", "HOME_IMPROVEMENT_HARDWARE", "HOME_IMPROVEMENT"],
      [5, 2, 48_000, "LANDLORD INSURANCE", "GENERAL_SERVICES_INSURANCE", "GENERAL_SERVICES"],
      [11, 2, 48_000, "LANDLORD INSURANCE", "GENERAL_SERVICES_INSURANCE", "GENERAL_SERVICES"],
    ] as const
  ).entries()) {
    for (const y of [end.getUTCFullYear() - 1, end.getUTCFullYear()]) {
      const date = `${y}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
      if (date > iso(yearAgo) && date <= iso(end)) {
        rows.push({
          key: `x${i}-${date}`,
          date,
          amountCents: cents,
          description,
          detailed,
          primary,
        });
      }
    }
  }
  await db.transactions.createMany({
    data: rows.map((r) => ({
      userId,
      accountId: checking.id,
      source: "plaid" as const,
      plaidTransactionId: `demo-rental-${userId}-${r.key}`,
      date: new Date(`${r.date}T00:00:00Z`),
      amountCents: r.amountCents,
      description: r.description,
      pfcPrimary: r.primary,
      pfcDetailed: r.detailed,
      categorySource: "plaid" as const,
      pending: false,
    })),
    skipDuplicates: true,
  });
  await logAudit(
    { type: "user", id: userId },
    "rental_added",
    { type: "user", id: userId },
    { demo: true },
  );
}
