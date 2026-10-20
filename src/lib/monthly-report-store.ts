import { MONTHLY_REPORT_DAYS } from "@/config/monthly-report";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import type { MonthlyReport } from "@/planning/monthly-report";

// The monthly money reports kept (spec step 148), read by the chat, the page and Claude.
// Made by src/lib/monthly-report.ts.

type Options = { client?: PrismaClient; now?: Date };

export type StoredReport = { id: string; month: string; report: MonthlyReport; createdAt: Date };

const reportOf = (value: Prisma.JsonValue) => value as unknown as MonthlyReport;

export async function storedReport(
  userId: string,
  month: string | null,
  { client = defaultClient }: Options = {},
): Promise<StoredReport | null> {
  const row = await scopedFor(userId, client).monthlyReports.findFirst({
    where: month ? { month } : {},
    orderBy: { month: "desc" },
    select: { id: true, month: true, figures: true, createdAt: true },
  });
  return (
    row && { id: row.id, month: row.month, report: reportOf(row.figures), createdAt: row.createdAt }
  );
}

const DAY_MS = 24 * 60 * 60 * 1000;

// The newest report, while it's new (made in the last MONTHLY_REPORT_DAYS): for the chat.
export async function recentReport(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<StoredReport | null> {
  const stored = await storedReport(userId, null, { client });
  return stored && now.getTime() - stored.createdAt.getTime() <= MONTHLY_REPORT_DAYS * DAY_MS
    ? stored
    : null;
}
