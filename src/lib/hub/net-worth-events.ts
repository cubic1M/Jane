import type { PrismaClient } from "@/generated/prisma/client";
import { DEBT_ACCOUNT_TYPES } from "@/config/net-worth";
import {
  investmentMonths,
  janeSaved,
  movementOf,
  paidOff,
  significantDays,
  transactionEvent,
  type EventGroup,
  type NetWorthEvent,
} from "@/insights/net-worth-events";
import { accountLabels } from "@/lib/account-labels";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { isoDay as day } from "@/lib/dates";

// The net worth chart's events (src/insights/net-worth-events.ts), from the person's own
// transactions, balances and what Jane did, since `from` (the chart's first day).

export async function netWorthEvents(
  userId: string,
  from: string,
  netWorthCents: number,
  { client = defaultClient }: { client?: PrismaClient } = {},
): Promise<EventGroup[]> {
  return significantDays(await loadEvents(userId, from, { client, every: false }), netWorthCents);
}

// Every movement since `from`, oldest first (founder: "a dot for EVERY single little movement
// in cash"): each transaction, transfers between the person's own accounts included, the
// investment months, loans paid off and what Jane saved. For the expanded chart, fetched when
// it opens (/api/net-worth/movements).
export async function netWorthMovements(
  userId: string,
  from: string,
  { client = defaultClient }: { client?: PrismaClient } = {},
): Promise<NetWorthEvent[]> {
  const events = await loadEvents(userId, from, { client, every: true });
  return events.sort((a, b) => a.date.localeCompare(b.date));
}

async function loadEvents(
  userId: string,
  from: string,
  { client, every }: { client: PrismaClient; every: boolean },
): Promise<NetWorthEvent[]> {
  const db = scopedFor(userId, client);
  const since = new Date(`${from}T00:00:00Z`);
  const [accounts, transactions, snapshots, actions] = await Promise.all([
    db.accounts.findMany({
      select: { id: true, name: true, type: true, mask: true, createdAt: true },
    }),
    db.transactions.findMany({
      where: { pending: false, date: { gte: since } },
      // A day's movements in the order they posted, the same each time.
      orderBy: [{ date: "asc" }, { id: "asc" }],
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
  // Each account as the loan pages name it, so two that read the same are told apart.
  const labelOf = accountLabels(accounts);

  const events: NetWorthEvent[] = transactions.flatMap((t) => {
    const read = every ? movementOf : transactionEvent;
    const e = read({
      date: day(t.date),
      amountCents: t.amountCents,
      name: t.merchantName ?? t.description,
      pfcPrimary: t.pfcPrimary,
      pfcDetailed: t.pfcDetailed,
      accountType: typeOf.get(t.accountId) ?? "depository",
      account: labelOf.get(t.accountId),
    });
    return e ? [e] : [];
  });

  for (const a of accounts) {
    const balances = snapshots
      .filter((s) => s.accountId === a.id)
      .map((s) => ({ date: day(s.date), cents: s.balanceCents }));
    if (balances.length === 0) continue;
    if (DEBT_ACCOUNT_TYPES.includes(a.type)) {
      const done = paidOff({ id: a.id, name: a.name, label: labelOf.get(a.id), balances });
      if (done) events.push(done);
    } else if (a.type === "investment") {
      events.push(
        ...investmentMonths({ id: a.id, name: a.name, label: labelOf.get(a.id), balances }),
      );
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

  return events;
}
