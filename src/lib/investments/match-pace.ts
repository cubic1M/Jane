import { onlyCounted } from "@/lib/account-copies";
import { EMPLOYER_CONTRIBUTION } from "@/config/retirement";
import { CONTRIBUTION_TX_SUBTYPES, WORKPLACE_SUBTYPES } from "@/config/retirement-accounts";
import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { scopedFor, type ScopedDb } from "@/lib/db-scoped";
import { todayOf } from "@/lib/today";
import { matchPaceGap } from "@/planning/retirement-accounts";
import { employerPlanFor } from "./employer-plan";

// The employer match left on the table at this year's pace, for the suggestion in the brief:
// the same numbers and the same calculation (matchPaceGap) as the retirement accounts page and
// Jane's answer in the chat. Null when no employer plan is known.
export async function loadMatchPace(
  userId: string,
  { client = defaultClient, now = new Date() }: { client?: PrismaClient; now?: Date } = {},
) {
  const plan = await employerPlanFor(userId, client);
  if (!plan) return null;
  const db = scopedFor(userId, client);
  const workplace = await db.accounts.findMany({
    where: { type: "investment", ...(await onlyCounted(db)) },
    select: { id: true, subtype: true },
  });
  const ids = workplace
    .filter((a) => WORKPLACE_SUBTYPES.includes((a.subtype ?? "").toLowerCase()))
    .map((a) => a.id);
  // The person's own year so far (src/lib/today.ts), not UTC's.
  const today = await todayOf(userId, { client, now });
  const txs =
    ids.length === 0
      ? []
      : await db.investmentTransactions.findMany({
          where: {
            accountId: { in: ids },
            subtype: { in: [...CONTRIBUTION_TX_SUBTYPES] },
            date: { gte: yearStart(today), lte: dayDate(today) },
          },
          select: { name: true, amountCents: true },
        });
  // Money in is negative in Plaid's sign; the employer's own part is not the person's.
  const employeeYtd = Math.max(
    0,
    txs.filter((t) => !EMPLOYER_CONTRIBUTION.test(t.name)).reduce((s, t) => s - t.amountCents, 0),
  );
  const through = await dataThrough(db, ids, today);
  return { ...matchPaceGap(plan, employeeYtd, { today, through }), payCents: plan.payCents };
}

const dayDate = (day: string) => new Date(`${day}T00:00:00Z`);
export const yearStart = (today: string) => dayDate(`${today.slice(0, 4)}-01-01`);

// The newest day these accounts' data covers, on or before today: the pace runs to it, so an
// account read weeks ago isn't taken for one whose contributions stopped. Null with no data.
export async function dataThrough(
  db: ScopedDb,
  accountIds: string[],
  today: string,
): Promise<string | null> {
  if (accountIds.length === 0) return null;
  const newest = await db.investmentTransactions.findFirst({
    where: { accountId: { in: accountIds }, date: { lte: dayDate(today) } },
    orderBy: { date: "desc" },
    select: { date: true },
  });
  return newest ? newest.date.toISOString().slice(0, 10) : null;
}
