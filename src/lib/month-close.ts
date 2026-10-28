import { MONTH_CLOSE_DAY } from "@/config/month-close";
import { BOOKS_WORRYING_KINDS } from "@/config/books";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { previousMonth } from "@/insights/check-in";

import { track } from "@/lib/analytics";
import { openBooks } from "@/lib/books";
import { cryptoTotal } from "@/lib/crypto/crypto";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { localDate } from "@/lib/digest/week";
import { monthlyReportFor } from "@/lib/monthly-report";
import { storedReport } from "@/lib/monthly-report-store";
import {
  monthFigures,
  uncertainOf,
  type CloseFigures,
  type CloseTx,
  closeNetWorth,
} from "@/planning/month-close";

// The monthly close (spec step 244). From the first of the month Jane closes the month before,
// like a company's books: the books checked (step 238), the charges it wasn't sure of asked
// about in one message, a net worth snapshot, plan against actual (step 205) and what worked
// (step 207) from the month's report (step 148). With nothing uncertain it closes with no taps.
// A closed month's figures are kept and only change when the person corrects something in it.

type Options = { client?: PrismaClient; now?: Date };

export type CloseView = {
  month: string;
  status: "waiting" | "closed";
  figures: CloseFigures;
  // While waiting: the charges asked about.
  uncertain: { id: string; date: string; description: string; amountCents: number }[];
  closedAt: string | null;
  correctedAt: string | null;
};

const nextMonth = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
};

async function monthTxns(userId: string, month: string, client: PrismaClient): Promise<CloseTx[]> {
  const rows = await scopedFor(userId, client).transactions.findMany({
    where: {
      date: {
        gte: new Date(`${month}-01T00:00:00Z`),
        lt: new Date(`${nextMonth(month)}-01T00:00:00Z`),
      },
      pending: false,
    },
    select: {
      id: true,
      date: true,
      amountCents: true,
      description: true,
      pfcPrimary: true,
      pfcDetailed: true,
      categorySource: true,
    },
  });
  return rows.map((r) => ({ ...r, date: r.date.toISOString().slice(0, 10) }));
}

// The month's figures as they stand: the transactions, the books, net worth now and the report.
async function figuresFor(
  userId: string,
  month: string,
  confirmed: number,
  client: PrismaClient,
  keep?: Pick<CloseFigures, "netWorthCents" | "netWorthNotCounting" | "booksOpen">,
): Promise<CloseFigures> {
  const db = scopedFor(userId, client);
  const [txns, accounts, books, report, owned, crypto] = await Promise.all([
    monthTxns(userId, month, client),
    keep
      ? null
      : db.accounts.findMany({
          select: { id: true, name: true, type: true, currentBalanceCents: true },
        }),
    keep ? null : openBooks(userId, { client }),
    storedReport(userId, month, { client }),
    // What they own and their crypto, as the net worth page and the chat count them.
    keep ? [] : db.ownedAssets.findMany({ select: { id: true, valueCents: true, valuedOn: true } }),
    keep ? 0 : cryptoTotal(userId, { client }),
  ]);
  const r = report?.report;
  return {
    ...monthFigures(txns, month),
    // A snapshot at the close; a correction later keeps the one taken then.
    // Never a silent $0 or a figure that leaves an account out: null when no balance is known,
    // and what it leaves out said beside it.
    ...(keep
      ? { netWorthCents: keep.netWorthCents, netWorthNotCounting: keep.netWorthNotCounting ?? null }
      : closeNetWorth(accounts!, owned, crypto)),
    booksOpen: keep
      ? keep.booksOpen
      : books!.open.filter((o) => BOOKS_WORRYING_KINDS.includes(o.kind)).length,
    paidDownCents: r?.paidDownCents ?? null,
    plan: r?.plan ? { planned: r.plan.planned, did: r.plan.did } : null,
    worked: r?.worked ?? null,
    confirmed,
  };
}

const viewOf = (
  row: {
    month: string;
    status: string;
    figures: unknown;
    uncertain: string[];
    closedAt: Date | null;
    correctedAt: Date | null;
  },
  uncertain: CloseView["uncertain"] = [],
): CloseView => ({
  month: row.month,
  status: row.status === "closed" ? "closed" : "waiting",
  figures: row.figures as CloseFigures,
  uncertain,
  closedAt: row.closedAt?.toISOString() ?? null,
  correctedAt: row.correctedAt?.toISOString() ?? null,
});

// Run with the day's agent run: closes last month once its first day has come. Returns what
// happened: closed (with no taps), waiting (a question was needed) or none.
export async function runMonthClose(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<"closed" | "waiting" | "none"> {
  const user = await client.user.findUnique({ where: { id: userId }, select: { timezone: true } });
  const today = localDate(now, user?.timezone);
  if (Number(today.slice(8, 10)) < MONTH_CLOSE_DAY) return "none";
  const month = previousMonth(today);
  const db = scopedFor(userId, client);
  const existing = await db.monthCloses.findFirst({ where: { month } });
  if (existing?.status === "closed") return "none";
  const txns = await monthTxns(userId, month, client);
  if (txns.length === 0) return "none";
  // The report carries plan against actual and what worked; make it now if it isn't yet.
  await monthlyReportFor(userId, { client, now }).catch(() => null);
  const uncertain = uncertainOf(txns, month);
  if (uncertain.length > 0) {
    const figures = await figuresFor(userId, month, 0, client);
    const data = {
      status: "waiting",
      uncertain: uncertain.map((t) => t.id),
      figures: figures as unknown as Prisma.InputJsonObject,
    };
    if (existing) await db.monthCloses.updateMany({ where: { id: existing.id }, data });
    else await db.monthCloses.create({ data: { userId, month, ...data, createdAt: now } });
    return "waiting";
  }
  await close(userId, month, 0, existing?.id ?? null, { client, now });
  return "closed";
}

async function close(
  userId: string,
  month: string,
  confirmed: number,
  id: string | null,
  { client, now }: { client: PrismaClient; now: Date },
) {
  const db = scopedFor(userId, client);
  const figures = (await figuresFor(
    userId,
    month,
    confirmed,
    client,
  )) as unknown as Prisma.InputJsonObject;
  const data = { status: "closed", uncertain: [], figures, closedAt: now };
  if (id) await db.monthCloses.updateMany({ where: { id }, data });
  else await db.monthCloses.create({ data: { userId, month, ...data, createdAt: now } });
  await track(userId, "month_closed", { month, confirmed });
}

// The person's one tap: the charges Jane asked about are right as they are; the month closes.
export async function confirmClose(
  userId: string,
  month: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<CloseView> {
  const db = scopedFor(userId, client);
  const row = await db.monthCloses.findFirst({ where: { month } });
  if (!row) throw new MonthCloseError("There's no close waiting for that month.");
  if (row.status !== "closed") {
    // Marked as the person's own, so they're never asked about again.
    await db.transactions.updateMany({
      where: { id: { in: row.uncertain } },
      data: { categorySource: "user" },
    });
    await close(userId, month, row.uncertain.length, row.id, { client, now });
  }
  return (await loadClose(userId, { client, now, month }))!;
}

export class MonthCloseError extends Error {}

// After the person corrects something (a category) in a closed month: its figures are worked
// out again from the corrected data and marked corrected. The net worth snapshot and the
// books count stay as they were at the close. Nothing else ever changes a closed month.
export async function correctClosedMonths(
  userId: string,
  months: readonly string[],
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<number> {
  const db = scopedFor(userId, client);
  const rows = await db.monthCloses.findMany({
    where: { month: { in: [...new Set(months)] }, status: "closed" },
  });
  for (const row of rows) {
    const before = row.figures as unknown as CloseFigures;
    const figures = await figuresFor(userId, row.month, before.confirmed, client, before);
    await db.monthCloses.updateMany({
      where: { id: row.id },
      data: { figures: figures as unknown as Prisma.InputJsonObject, correctedAt: now },
    });
  }
  return rows.length;
}

// The latest close (or one month's), with the charges asked about while it waits.
export async function loadClose(
  userId: string,
  { client = defaultClient, month }: Options & { month?: string } = {},
): Promise<CloseView | null> {
  const db = scopedFor(userId, client);
  const row = await db.monthCloses.findFirst({
    where: month ? { month } : {},
    orderBy: { month: "desc" },
  });
  if (!row) return null;
  const asked =
    row.status === "closed" || row.uncertain.length === 0
      ? []
      : await db.transactions.findMany({
          where: { id: { in: row.uncertain } },
          select: { id: true, date: true, description: true, amountCents: true },
          orderBy: { amountCents: "desc" },
        });
  return viewOf(
    row,
    asked.map((t) => ({ ...t, date: t.date.toISOString().slice(0, 10) })),
  );
}
