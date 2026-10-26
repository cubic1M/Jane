import {
  LENDER_PARTNER,
  REFI_CHECK_DAYS,
  REFI_MIN_SAVING_CENTS,
  type LoanProduct,
} from "@/config/debt";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { adviceMode } from "@/lib/advice-mode";
import { track } from "@/lib/analytics";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { creditBandFor } from "@/lib/credit";
import { debtsOr, loadDebts } from "@/lib/debts";
import type { DebtBook } from "@/insights/debts";
import { demoLender } from "@/lib/lenders/demo";
import { upsertOnce } from "@/lib/unique-race";
import type {
  LenderPartner,
  LoanOffer,
  PrequalifyRequest,
  TransferOffer,
} from "@/lib/lenders/partner";
import { compareRefinance, refinanceable, type RefinanceComparison } from "@/planning/refinance";

// Refinance offers (spec step 111). Once a month Jane asks the lender partner, by
// itself, what the person prequalifies for on each loan and card (a soft check), and
// keeps the offers. Each is compared with keeping the debt over the same months, fees
// included. Only the stand-in catalog exists, so only demo-bank people get offers, always
// labelled as demo advice; nothing is ever applied for without a tap (spec step 112).

type Options = { client?: PrismaClient; now?: Date };

const DAY_MS = 24 * 60 * 60 * 1000;
const isoDay = (date: Date) => date.toISOString().slice(0, 10);

export type TransferQuote = { debtKey: string; amountCents: number; offers: TransferOffer[] };

// What the fit engine (src/planning/fit.ts) said about refinancing this debt when the offers
// were checked (loans QA), so the offers page, the chat, Claude's tool and the proactive message
// never pick a loan the fit engine would not, the same as the options card and "should I
// consolidate?": a lender would likely turn the person down (their score, or debt payments over
// the limit with the new loan), or a debt their spare cash clears for less than any loan while
// keeping their emergency cushion (one rule for cards, car and student loans alike).
// pickLender: the lender of the fit engine's pick over the debt's own months, or null when it
// picked none (keep what you have, or the above); the offers page names the same.
export type FitVerdict = {
  turnedDown: string | null;
  cashPayoffCents: number | null;
  pickLender?: string | null;
};

export type Quote = {
  debtKey: string;
  product: LoanProduct;
  termMonths: number;
  amountCents: number;
  offers: LoanOffer[];
  // Absent on offers checked before the fit engine was asked (they're checked again).
  verdict?: FitVerdict;
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
  // The fit engine's verdict on each (imported here: src/lib/fit.ts reads this file's partner).
  const { loadFit } = await import("@/lib/fit");
  for (const q of quotes) {
    const fit = await loadFit(userId, { need: "refinance", debtKey: q.debtKey }, { client, now });
    const payoff = fit.pick === "payoff" ? fit.options.find((o) => o.id === "payoff") : null;
    const anyLoan = fit.options.some((o) => o.id !== "keep" && o.id !== "payoff");
    const picked = fit.options.find((o) => o.id === fit.pick);
    q.verdict = {
      pickLender: picked && picked.id !== "keep" && picked.id !== "payoff" ? picked.lender : null,
      // Any kind of debt, as the options card: the cash covers it and keeps the cushion.
      cashPayoffCents: payoff ? (payoff.savesCents ?? 0) : null,
      turnedDown:
        fit.available && !anyLoan && !payoff && fit.ineligible.length > 0
          ? fit.ineligible[0].reason
          : null,
    };
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
  // Two pages loading at once can both check: the second one's save updates.
  await upsertOnce(() =>
    scopedFor(userId, client).refinanceChecks.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    }),
  );
  await track(userId, "refinance_checked", { debts: quotes.length });
  return quotes;
}

// Offers kept before the fit engine's verdicts were stored: checked again, so no stale pick is
// shown.
const unjudged = (quotes: unknown) =>
  Array.isArray(quotes) &&
  quotes.some((q) => !(q as Quote).verdict || !("pickLender" in (q as Quote).verdict!));

// Jane's monthly check, before its brain looks at the person's money: asks again once
// REFI_CHECK_DAYS have passed. True when it asked.
export async function refreshRefinance(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<boolean> {
  const row = await scopedFor(userId, client).refinanceChecks.findFirst({
    select: { checkedOn: true, quotes: true },
  });
  if (
    row &&
    !unjudged(row.quotes) &&
    now.getTime() - row.checkedOn.getTime() < REFI_CHECK_DAYS * DAY_MS
  )
    return false;
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
  { client = defaultClient, now = new Date(), book: given }: Options & { book?: DebtBook } = {},
): Promise<Refinance> {
  const [found, row, book] = await Promise.all([
    lenderPartnerFor(userId, { client }),
    scopedFor(userId, client).refinanceChecks.findFirst({
      select: { checkedOn: true, quotes: true },
    }),
    debtsOr(given, userId, { client, now }),
  ]);
  if (!found) return { available: false, checkedOn: null, comparisons: [] };
  const quotes = (Array.isArray(row?.quotes) ? row.quotes : []) as unknown as Quote[];
  const asOf = isoDay(now);
  const comparisons = quotes.flatMap((q) => {
    const debt = book.debts.find((d) => d.key === q.debtKey);
    // The fit engine's pick when it was asked; offers kept before that pick here.
    const pickLender =
      q.verdict && "pickLender" in q.verdict ? (q.verdict.pickLender ?? null) : undefined;
    const comparison = debt && compareRefinance(debt, q.offers, asOf, pickLender);
    if (!comparison || comparison.offers.length === 0) return [];
    const v = q.verdict;
    if (v?.cashPayoffCents) {
      return [{ ...comparison, pick: null, cashPayoffCents: v.cashPayoffCents }];
    }
    // Only where an offer would otherwise be worth it: "the offers look cheaper, but...".
    if (v?.turnedDown && comparison.offers.some((o) => o.savingCents >= REFI_MIN_SAVING_CENTS)) {
      return [{ ...comparison, pick: null, turnedDown: v.turnedDown }];
    }
    return [comparison];
  });
  return {
    available: true,
    checkedOn: row ? isoDay(row.checkedOn) : null,
    comparisons: comparisons.sort(
      (a, b) => (b.pick?.savingCents ?? 0) - (a.pick?.savingCents ?? 0),
    ),
  };
}

// Before Jane's first monthly check (its runs skip quiet hours), asking now: when the
// person opens the offers. Returns whether it asked.
export async function ensureChecked(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<boolean> {
  const row = await scopedFor(userId, client).refinanceChecks.findFirst({
    select: { quotes: true },
  });
  if (row && !unjudged(row.quotes)) return false;
  return (await checkRates(userId, { client, now })) !== null;
}
