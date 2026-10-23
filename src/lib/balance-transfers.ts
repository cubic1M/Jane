import type { PrismaClient } from "@/generated/prisma/client";
import { track } from "@/lib/analytics";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { debtsOr, loadDebts } from "@/lib/debts";
import type { DebtBook } from "@/insights/debts";
import { addDeadline, markDeadlineDone } from "@/lib/deadlines";
import { formatCents } from "@/lib/money";
import { lenderPartnerFor, type TransferQuote } from "@/lib/refinance";
import {
  compareTransfers,
  scoreTransfer,
  type TransferComparison,
} from "@/planning/balance-transfer";

// Balance transfers (spec step 113). Jane finds 0% transfer cards for each card with her
// monthly rate check (src/lib/refinance.ts checkRates) and compares them, fee counted. Opening
// the card and moving the money are the person's; once they say they've moved a balance,
// Jane keeps the promo's end in view: a deadline on /deadlines and reminders before it.

type Options = { client?: PrismaClient; now?: Date };

const isoDay = (date: Date) => date.toISOString().slice(0, 10);

export class TransferError extends Error {}

export type TransferView = {
  id: string;
  fromDebtKey: string;
  fromName: string;
  issuer: string;
  cardName: string;
  amountCents: number;
  feeCents: number;
  promoMonths: number;
  goToAprBps: number;
  monthlyNeededCents: number;
  startedOn: string;
  promoEndsOn: string;
  status: "active" | "done" | "cancelled";
};

const SELECT = {
  id: true,
  fromDebtKey: true,
  fromName: true,
  issuer: true,
  cardName: true,
  amountCents: true,
  feeCents: true,
  promoMonths: true,
  goToAprBps: true,
  monthlyNeededCents: true,
  startedOn: true,
  promoEndsOn: true,
  status: true,
  deadlineId: true,
} as const;

function toView(row: {
  id: string;
  fromDebtKey: string;
  fromName: string;
  issuer: string;
  cardName: string;
  amountCents: number;
  feeCents: number;
  promoMonths: number;
  goToAprBps: number;
  monthlyNeededCents: number;
  startedOn: Date;
  promoEndsOn: Date;
  status: string;
}): TransferView {
  return {
    ...row,
    startedOn: isoDay(row.startedOn),
    promoEndsOn: isoDay(row.promoEndsOn),
    status: row.status === "done" || row.status === "cancelled" ? row.status : "active",
  };
}

export type Transfers = {
  available: boolean;
  // Each card with offers, best saving first.
  comparisons: TransferComparison[];
  // Transfers the person made, still running first.
  transfers: TransferView[];
};

export async function loadTransfers(
  userId: string,
  { client = defaultClient, now = new Date(), book: given }: Options & { book?: DebtBook } = {},
): Promise<Transfers> {
  const db = scopedFor(userId, client);
  const [found, row, book, rows] = await Promise.all([
    lenderPartnerFor(userId, { client }),
    db.refinanceChecks.findFirst({ select: { transfers: true } }),
    debtsOr(given, userId, { client, now }),
    db.balanceTransfers.findMany({
      select: SELECT,
      orderBy: [{ status: "asc" }, { promoEndsOn: "asc" }],
    }),
  ]);
  const transfers = rows.map(toView);
  if (!found) return { available: false, comparisons: [], transfers };
  const quotes = (Array.isArray(row?.transfers) ? row.transfers : []) as unknown as TransferQuote[];
  const asOf = isoDay(now);
  const comparisons = quotes.flatMap((q) => {
    const debt = book.debts.find((d) => d.key === q.debtKey);
    const comparison = debt && compareTransfers(debt, q.offers, asOf);
    return comparison && comparison.offers.length > 0 ? [comparison] : [];
  });
  return {
    available: true,
    comparisons: comparisons.sort(
      (a, b) => (b.pick?.savingCents ?? 0) - (a.pick?.savingCents ?? 0),
    ),
    transfers,
  };
}

// The person moved a card's balance to this 0% card: Jane records it, works out the
// payment that clears it in time, and puts the promo's end on their deadlines.
export async function startTransfer(
  userId: string,
  input: { debtKey: string; offerId: string },
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<TransferView> {
  const db = scopedFor(userId, client);
  const [row, book, running] = await Promise.all([
    db.refinanceChecks.findFirst({ select: { transfers: true } }),
    loadDebts(userId, { client, now }),
    db.balanceTransfers.findFirst({
      where: { fromDebtKey: input.debtKey, status: "active" },
      select: { cardName: true },
    }),
  ]);
  if (running)
    throw new TransferError(`You're already tracking a transfer to ${running.cardName}.`);
  const quotes = (Array.isArray(row?.transfers) ? row.transfers : []) as unknown as TransferQuote[];
  const offer = quotes
    .find((q) => q.debtKey === input.debtKey)
    ?.offers.find((o) => o.id === input.offerId);
  const debt = book.debts.find((d) => d.key === input.debtKey);
  if (!offer || !debt || !debt.balanceCents || debt.aprBps === null) {
    throw new TransferError("That offer isn't there anymore. Check rates again.");
  }
  const asOf = isoDay(now);
  const scored = scoreTransfer(debt.balanceCents, debt.aprBps, offer, asOf);
  const title = `0% ends on ${offer.cardName}: pay off the balance you moved`;
  await addDeadline(
    userId,
    {
      title,
      dueOn: scored.promoEndsOn,
      kind: "other",
      note: `Pay ${formatCents(scored.monthlyNeededCents)} a month to clear it in time. After this it's charged interest.`,
    },
    { client, now },
  );
  const deadline = await db.deadlines.findFirst({
    where: { title, dueOn: new Date(`${scored.promoEndsOn}T00:00:00Z`) },
    select: { id: true },
    orderBy: { createdAt: "desc" },
  });
  const created = await db.balanceTransfers.create({
    data: {
      userId,
      fromDebtKey: debt.key,
      fromName: debt.name,
      offerId: offer.id,
      issuer: offer.issuer,
      cardName: offer.cardName,
      amountCents: debt.balanceCents,
      feeCents: offer.feeCents,
      promoMonths: offer.promoMonths,
      goToAprBps: offer.goToAprBps,
      monthlyNeededCents: scored.monthlyNeededCents,
      startedOn: new Date(`${asOf}T00:00:00Z`),
      promoEndsOn: new Date(`${scored.promoEndsOn}T00:00:00Z`),
      deadlineId: deadline?.id ?? null,
    },
    select: SELECT,
  });
  // It's also the card's 0% promotion: one record, tracked for pace on /loans/interest with the
  // transfer's own deadline, never a second one (docs/feature-audit.md, cluster 14).
  await db.cardPromos.create({
    data: {
      userId,
      cardName: offer.cardName,
      balanceCents: debt.balanceCents + offer.feeCents,
      startedOn: new Date(`${asOf}T00:00:00Z`),
      endsOn: new Date(`${scored.promoEndsOn}T00:00:00Z`),
      goToAprBps: offer.goToAprBps,
      deadlineId: deadline?.id ?? null,
      balanceTransferId: created.id,
    },
  });
  await track(userId, "balance_transfer_started", { promo_months: offer.promoMonths });
  return toView(created);
}

// Paid off before the 0% ended (or not wanted any more): its deadline is ticked off too.
export async function endTransfer(
  userId: string,
  id: string,
  how: "done" | "cancelled",
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<TransferView> {
  const db = scopedFor(userId, client);
  const row = await db.balanceTransfers.findFirst({
    where: { id, status: "active" },
    select: SELECT,
  });
  if (!row) throw new TransferError("That transfer isn't running anymore.");
  const updated = await db.balanceTransfers.update({
    where: { id: row.id },
    data: { status: how, doneAt: now },
    select: SELECT,
  });
  if (row.deadlineId) await markDeadlineDone(userId, row.deadlineId, { client, now });
  // Its promotion is over too.
  await db.cardPromos.deleteMany({ where: { balanceTransferId: row.id } });
  await track(userId, "balance_transfer_ended", { how });
  return toView(updated);
}
