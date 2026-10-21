import { EMPLOYER_CONTRIBUTION } from "@/config/retirement";
import { CONTRIBUTION_TX_SUBTYPES, WORKPLACE_SUBTYPES } from "@/config/retirement-accounts";
import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
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
    where: { type: "investment" },
    select: { id: true, subtype: true },
  });
  const ids = workplace
    .filter((a) => WORKPLACE_SUBTYPES.includes((a.subtype ?? "").toLowerCase()))
    .map((a) => a.id);
  const txs =
    ids.length === 0
      ? []
      : await db.investmentTransactions.findMany({
          where: {
            accountId: { in: ids },
            subtype: { in: [...CONTRIBUTION_TX_SUBTYPES] },
            date: { gte: new Date(Date.UTC(now.getUTCFullYear(), 0, 1)), lte: now },
          },
          select: { name: true, amountCents: true },
        });
  // Money in is negative in Plaid's sign; the employer's own part is not the person's.
  const employeeYtd = Math.max(
    0,
    txs.filter((t) => !EMPLOYER_CONTRIBUTION.test(t.name)).reduce((s, t) => s - t.amountCents, 0),
  );
  return { ...matchPaceGap(plan, employeeYtd, now), payCents: plan.payCents };
}
