import type { PrismaClient } from "@/generated/prisma/client";
import { DEBT_ACCOUNT_TYPES } from "@/config/net-worth";
import {
  investmentMonths,
  janeSaved,
  paidOff,
  significantDays,
  transactionEvent,
  type EventGroup,
  type NetWorthEvent,
} from "@/insights/net-worth-events";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";

// The net worth chart's events (src/insights/net-worth-events.ts), from the person's own
// transactions, balances and what Jane did, since `from` (the chart's first day).

const day = (d: Date) => d.toISOString().slice(0, 10);

export async function netWorthEvents(
  userId: string,
  from: string,
  netWorthCents: number,
  { client = defaultClient }: { client?: PrismaClient } = {},
): Promise<EventGroup[]> {
  const db = scopedFor(userId, client);
  const since = new Date(`${from}T00:00:00Z`);
  const [accounts, transactions, snapshots, actions] = await Promise.all([
    db.accounts.findMany({ select: { id: true, name: true, type: true } }),
    db.transactions.findMany({
      where: { pending: false, date: { gte: since } },
      select: {
        accountId: true,
        date: true,
        amountCents: true,
        merchantName: true,
        description: true,
        pfcPrimary: true,
        pfcDetailed: true,
      },
    }),
    db.balanceSnapshots.findMany({
      where: { date: { gte: since } },
      select: { accountId: true, date: true, balanceCents: true },
      orderBy: { date: "asc" },
    }),
    db.actions.findMany({
      where: { status: "done", completedAt: { gte: since } },
      select: {
        completedAt: true,
        refundCents: true,
        confirmedAnnualCents: true,
        decision: { select: { finding: { select: { title: true } } } },
      },
    }),
  ]);
  const typeOf = new Map(accounts.map((a) => [a.id, a.type]));

  const events: NetWorthEvent[] = transactions.flatMap((t) => {
    const e = transactionEvent({
      date: day(t.date),
      amountCents: t.amountCents,
      name: t.merchantName ?? t.description,
      pfcPrimary: t.pfcPrimary,
      pfcDetailed: t.pfcDetailed,
      accountType: typeOf.get(t.accountId) ?? "depository",
    });
    return e ? [e] : [];
  });

  for (const a of accounts) {
    const balances = snapshots
      .filter((s) => s.accountId === a.id)
      .map((s) => ({ date: day(s.date), cents: s.balanceCents }));
    if (balances.length === 0) continue;
    if (DEBT_ACCOUNT_TYPES.includes(a.type)) {
      const done = paidOff({ id: a.id, name: a.name, balances });
      if (done) events.push(done);
    } else if (a.type === "investment") {
      events.push(...investmentMonths({ id: a.id, name: a.name, balances }));
    }
  }

  for (const a of actions) {
    if (!a.completedAt) continue;
    const saved = janeSaved({
      date: day(a.completedAt),
      title: a.decision.finding.title,
      cents: a.refundCents ?? a.confirmedAnnualCents ?? 0,
    });
    if (saved) events.push(saved);
  }

  return significantDays(events, netWorthCents);
}
