import { LENDER_PARTNER, REFI_CHECK_DAYS, type LoanProduct } from "@/config/debt";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { adviceMode } from "@/lib/advice-mode";
import { track } from "@/lib/analytics";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { creditBandFor } from "@/lib/credit";
import { loadDebts } from "@/lib/debts";
import { demoLender } from "@/lib/lenders/demo";
import type {
  LenderPartner,
  LoanOffer,
  PrequalifyRequest,
  TransferOffer,
} from "@/lib/lenders/partner";
import { compareRefinance, refinanceable, type RefinanceComparison } from "@/planning/refinance";

// Refinance offers (spec step 111). Once a month Jane asks the lender partner, by
// herself, what the person prequalifies for on each loan and card (a soft check), and
// keeps the offers. Each is compared with keeping the debt over the same months, fees
// included. Only the stand-in catalog exists, so only demo-bank people get offers, always
// labelled as demo advice; nothing is ever applied for without a tap (spec step 112).

type Options = { client?: PrismaClient; now?: Date };

const DAY_MS = 24 * 60 * 60 * 1000;
const isoDay = (date: Date) => date.toISOString().slice(0, 10);

export type TransferQuote = { debtKey: string; amountCents: number; offers: TransferOffer[] };

export type Quote = {
  debtKey: string;
  product: LoanProduct;
  termMonths: number;
  amountCents: number;
  offers: LoanOffer[];
};

// The partner for this person, or null: the stand-in only for demo-bank people in demo
// advice mode. A real account gets nothing until a loan marketplace partner is connected.
export async function lenderPartnerFor(
  userId: string,
  { client = defaultClient }: Options = {},
): Promise<{ key: string; partner: LenderPartner } | null> {
  if (LENDER_PARTNER !== "demo") return null;
  return (await adviceMode(userId, { client })) ? { key: "demo", partner: demoLender } : null;
}

// Asks the partner now for every debt that can be refinanced, and keeps the offers.
export async function checkRates(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<Quote[] | null> {
  const found = await lenderPartnerFor(userId, { client });
  if (!found) return null;
  const asOf = isoDay(now);
  const [book, creditBand] = await Promise.all([
    loadDebts(userId, { client, now }),
    // Spec step 116: priced by the latest score's band.
    creditBandFor(userId, { client }),
  ]);
  const quotes: Quote[] = [];
  for (const debt of book.debts) {
    const what = refinanceable(debt, asOf);
    if (!what) continue;
    const request: PrequalifyRequest = {
      product: what.product,
      amountCents: debt.balanceCents!,
      termMonths: what.termMonths,
      creditBand,
      month: asOf.slice(0, 7),
    };
    quotes.push({ debtKey: debt.key, ...request, offers: await found.partner.prequalify(request) });
  }
  // Spec step 113: 0% balance transfer cards for each card with a balance.
  const transfers: TransferQuote[] = [];
  for (const debt of book.debts) {
    if (debt.kind !== "card" || !debt.balanceCents || debt.balanceCents <= 0) continue;
    const request = {
      amountCents: debt.balanceCents,
      creditBand,
      month: asOf.slice(0, 7),
    };
    transfers.push({
      debtKey: debt.key,
      amountCents: debt.balanceCents,
      offers: await found.partner.balanceTransfers(request),
    });
  }
  const data = {
    checkedOn: new Date(`${asOf}T00:00:00Z`),
    partner: found.key,
    quotes: quotes as unknown as Prisma.InputJsonArray,
    transfers: transfers as unknown as Prisma.InputJsonArray,
  };
  await scopedFor(userId, client).refinanceChecks.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  });
  await track(userId, "refinance_checked", { debts: quotes.length });
  return quotes;
}

// Jane's monthly check, before her brain looks at the person's money: asks again once
// REFI_CHECK_DAYS have passed. True when it asked.
export async function refreshRefinance(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<boolean> {
  const row = await scopedFor(userId, client).refinanceChecks.findFirst({
    select: { checkedOn: true },
  });
  if (row && now.getTime() - row.checkedOn.getTime() < REFI_CHECK_DAYS * DAY_MS) return false;
  return (await checkRates(userId, { client, now })) !== null;
}

export type Refinance = {
  // Whether there's a partner for this person at all.
  available: boolean;
  checkedOn: string | null;
  // One per debt that has offers, the debts with a pick first.
  comparisons: RefinanceComparison[];
};

export async function loadRefinance(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<Refinance> {
  const [found, row, book] = await Promise.all([
    lenderPartnerFor(userId, { client }),
    scopedFor(userId, client).refinanceChecks.findFirst({
      select: { checkedOn: true, quotes: true },
    }),
    loadDebts(userId, { client, now }),
  ]);
  if (!found) return { available: false, checkedOn: null, comparisons: [] };
  const quotes = (Array.isArray(row?.quotes) ? row.quotes : []) as unknown as Quote[];
  const asOf = isoDay(now);
  const comparisons = quotes.flatMap((q) => {
    const debt = book.debts.find((d) => d.key === q.debtKey);
    const comparison = debt && compareRefinance(debt, q.offers, asOf);
    return comparison && comparison.offers.length > 0 ? [comparison] : [];
  });
  return {
    available: true,
    checkedOn: row ? isoDay(row.checkedOn) : null,
    comparisons: comparisons.sort(
      (a, b) => (b.pick?.savingCents ?? 0) - (a.pick?.savingCents ?? 0),
    ),
  };
}

// Before Jane's first monthly check (her runs skip quiet hours), asking now: when the
// person opens the offers. Returns whether it asked.
export async function ensureChecked(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<boolean> {
  const row = await scopedFor(userId, client).refinanceChecks.findFirst({ select: { id: true } });
  if (row) return false;
  return (await checkRates(userId, { client, now })) !== null;
}
