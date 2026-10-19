import { DEBT_AUTOPILOT, DEBT_DUE_DAYS, PAYDAY_LOOKBACK_DAYS } from "@/config/debt";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { track } from "@/lib/analytics";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { loadPayoff, startDebtPlan } from "@/lib/debt-plan";
import { debtsOr, loadDebts } from "@/lib/debts";
import type { DebtBook } from "@/insights/debts";
import { autopilotFor, mayAct, recordAct } from "@/lib/sector-autopilot";
import { dueMoves, paydaysOf, type DueMove } from "@/planning/due-dates";
import { rateChanges, type RateChange } from "@/planning/rate-watch";

export { rateChanges, type RateChange };

// Debt on autopilot (spec step 117). What Jane keeps up by herself for debts, at the
// person's debt autopilot level (step 141's sectors): she watches every rate the bank
// reports and records changes, drafts the request to move a payment that falls just before
// payday, and, when the debt sector allows the safe stuff, starts the payoff plan herself
// so the monthly check (step 110) has something to keep current. Nothing here moves money.

type Options = { client?: PrismaClient; now?: Date };

const DAY_MS = 24 * 60 * 60 * 1000;
const isoDay = (date: Date) => date.toISOString().slice(0, 10);
// The latest rate changes kept.
const CHANGES_KEPT = 10;

// Jane's pass before her brain looks at the person's money (src/lib/debt-refresh.ts).
export async function runDebtAutopilot(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<{ changes: RateChange[]; planStarted: boolean }> {
  const db = scopedFor(userId, client);
  const [book, watch] = await Promise.all([
    loadDebts(userId, { client, now }),
    db.debtWatches.findFirst({ select: { rates: true, changes: true, planStartedOn: true } }),
  ]);
  const seen = (watch?.rates ?? {}) as Record<string, number>;
  const { rates, changes } = rateChanges(seen, book.debts, isoDay(now));
  const kept = [...changes, ...((watch?.changes ?? []) as RateChange[])].slice(0, CHANGES_KEPT);

  // The payoff plan, started by Jane when the debt sector does the safe stuff.
  let planStarted = false;
  const plan = await db.debtPlans.findFirst({ select: { id: true } });
  if (!plan) {
    const allowed = await mayAct(userId, "debt", { needs: "safe", cents: 0 }, { client, now });
    const payoff = allowed.ok ? await loadPayoff(userId, { client, now }) : null;
    if (payoff && payoff.summary.cards.length > 0) {
      await startDebtPlan(
        userId,
        { strategy: payoff.summary.pick?.strategy ?? "avalanche", extraCents: 0 },
        { client, now },
      );
      await recordAct(userId, "debt", 0, "Started the payoff plan", { client, now });
      planStarted = true;
    }
  }
  const data = {
    rates: rates as Prisma.InputJsonObject,
    changes: kept as unknown as Prisma.InputJsonArray,
    ...(planStarted ? { planStartedOn: new Date(`${isoDay(now)}T00:00:00Z`) } : {}),
  };
  await db.debtWatches.upsert({ where: { userId }, create: { userId, ...data }, update: data });
  if (changes.length > 0) await track(userId, "debt_rate_changed", { count: changes.length });
  if (planStarted) await track(userId, "debt_plan_started_by_jane");
  return { changes, planStarted };
}

export type DebtDue = {
  debtKey: string;
  name: string;
  due: string;
  paymentCents: number | null;
  overdue: boolean;
};

export type DebtAutopilot = {
  level: "ask" | "safe" | "all";
  does: readonly { step: number; does: string }[];
  rateChanges: RateChange[];
  planStartedOn: string | null;
  dueMoves: DueMove[];
  // Debt payments in the next DEBT_DUE_DAYS, soonest first.
  upcoming: DebtDue[];
};

export async function loadDebtAutopilot(
  userId: string,
  { client = defaultClient, now = new Date(), book: given }: Options & { book?: DebtBook } = {},
): Promise<DebtAutopilot> {
  const db = scopedFor(userId, client);
  const [book, watch, sector, pay] = await Promise.all([
    debtsOr(given, userId, { client, now }),
    db.debtWatches.findFirst({ select: { changes: true, planStartedOn: true } }),
    autopilotFor(userId, "debt", { client, now }),
    db.transactions.findMany({
      where: {
        date: { gte: new Date(now.getTime() - PAYDAY_LOOKBACK_DAYS * DAY_MS) },
        amountCents: { lt: 0 },
        pfcDetailed: { in: ["INCOME_SALARY", "INCOME_WAGES"] },
      },
      select: { date: true },
    }),
  ]);
  const asOf = isoDay(now);
  const until = isoDay(new Date(now.getTime() + DEBT_DUE_DAYS * DAY_MS));
  return {
    level: sector.level,
    does: DEBT_AUTOPILOT[sector.level],
    rateChanges: (watch?.changes ?? []) as RateChange[],
    planStartedOn: watch?.planStartedOn ? isoDay(watch.planStartedOn) : null,
    dueMoves: dueMoves(book.debts, paydaysOf(pay.map((p) => isoDay(p.date)))),
    upcoming: book.debts
      .filter((d) => d.overdue || (d.nextDue !== null && d.nextDue >= asOf && d.nextDue <= until))
      .map((d) => ({
        debtKey: d.key,
        name: d.name,
        due: d.nextDue ?? asOf,
        paymentCents: d.paymentCents,
        overdue: d.overdue,
      }))
      .sort((a, b) => Number(b.overdue) - Number(a.overdue) || a.due.localeCompare(b.due)),
  };
}
