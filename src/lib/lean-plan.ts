import { LEAN_BILL_DAYS, LEAN_WAITABLE_PRIMARIES } from "@/config/lean-plan";
import { US_STATES } from "@/config/referrals";
import type { PrismaClient } from "@/generated/prisma/client";
import { loadDetectionInput } from "@/detection/engine";
import { upcomingBills } from "@/detection/forecast";
import { buildStreams } from "@/detection/streams";
import type { DetectionInput } from "@/detection/types";
import { employers } from "@/insights/changes";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { loadChanges } from "@/lib/changes";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { loadPayoff } from "@/lib/debt-plan";
import { healthInput } from "@/lib/health-score";
import { leanMessage, leanPlan, type LeanPlan } from "@/planning/lean-plan";

// When income stops (spec step 204). A paycheck that hasn't come in by the end of its window
// (the "late paycheck" change, src/insights/changes.ts, which never fires inside the
// window) gets one question. On a yes, automatic transfers from paychecks pause, and the
// one lean-plan message lists what can wait, hardship options and the unemployment guide.
// When a paycheck lands after the due day, it ends and Jane goes back to normal.

type Options = { client?: PrismaClient; now?: Date; input?: DetectionInput };

export type LeanState = {
  id: string;
  status: "proposed" | "active";
  employer: string;
  dueOn: string;
};

const MONTHLY: Record<string, number> = {
  WEEKLY: 52 / 12,
  BIWEEKLY: 26 / 12,
  SEMI_MONTHLY: 2,
  MONTHLY: 1,
  ANNUALLY: 1 / 12,
};

export async function leanActive(
  userId: string,
  { client = defaultClient }: Options = {},
): Promise<boolean> {
  return (await scopedFor(userId, client).leanPlans.count({ where: { status: "active" } })) > 0;
}

// What's open: the question to ask, or the plan in force.
export async function openLean(
  userId: string,
  { client = defaultClient }: Options = {},
): Promise<LeanState[]> {
  const rows = await scopedFor(userId, client).leanPlans.findMany({
    where: { status: { in: ["proposed", "active"] } },
    orderBy: { createdAt: "asc" },
    select: { id: true, status: true, employer: true, dueOn: true },
  });
  return rows.flatMap((r) =>
    r.status === "proposed" || r.status === "active" ? [{ ...r, status: r.status }] : [],
  );
}

// Asks about a newly late paycheck once, and ends the plan once pay is back. Returns what
// changed, for the log.
export async function runLeanCheck(
  userId: string,
  { client = defaultClient, now = new Date(), input: given }: Options = {},
): Promise<{ proposed: number; ended: number }> {
  const input = given ?? (await loadDetectionInput(userId, { client, now }));
  const db = scopedFor(userId, client);
  const out = { proposed: 0, ended: 0 };

  for (const change of (await loadChanges(userId, { client, now, input })).filter(
    (c) => c.kind === "paycheck_late",
  )) {
    const known = await db.leanPlans.findFirst({
      where: { changeKey: change.key },
      select: { id: true },
    });
    if (known) continue;
    await db.leanPlans.create({
      data: {
        userId,
        changeKey: change.key,
        employer: change.merchant ?? "your employer",
        dueOn: change.date,
        createdAt: now,
      },
    });
    out.proposed += 1;
  }

  // Pay is back: a deposit from any employer after the day it was due.
  const latest = employers(input)
    .map((e) => e.deposits.at(-1)?.date ?? "")
    .sort()
    .at(-1);
  for (const row of await db.leanPlans.findMany({
    where: { status: { in: ["proposed", "active"] } },
    select: { id: true, status: true, dueOn: true },
  })) {
    if (!latest || latest <= row.dueOn) continue;
    await db.leanPlans.updateMany({
      where: { id: row.id },
      data: { status: row.status === "active" ? "ended" : "declined", endedAt: now },
    });
    if (row.status === "active") {
      await logAudit(
        { type: "user", id: userId },
        "lean_plan_ended",
        { type: "lean_plan", id: row.id },
        {},
      );
      out.ended += 1;
    }
  }
  return out;
}

export class LeanError extends Error {}

export async function startLean(
  userId: string,
  id: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<void> {
  const { count } = await scopedFor(userId, client).leanPlans.updateMany({
    where: { id, status: "proposed" },
    data: { status: "active", startedAt: now },
  });
  if (count === 0) throw new LeanError("That question was already answered.");
  await logAudit({ type: "user", id: userId }, "lean_plan_started", { type: "lean_plan", id }, {});
  await track(userId, "lean_plan_started", {});
}

export async function declineLean(
  userId: string,
  id: string,
  { client = defaultClient }: Options = {},
): Promise<void> {
  const { count } = await scopedFor(userId, client).leanPlans.updateMany({
    where: { id, status: "proposed" },
    data: { status: "declined" },
  });
  if (count === 0) throw new LeanError("That question was already answered.");
}

// The plan itself, from the person's real numbers.
export async function loadLeanPlan(
  userId: string,
  { client = defaultClient, now = new Date(), input: given }: Options = {},
): Promise<{ plan: LeanPlan; message: string }> {
  const input = given ?? (await loadDetectionInput(userId, { client, now }));
  const [health, payoff, user] = await Promise.all([
    healthInput(userId, input, { client, now }),
    loadPayoff(userId, { client, now }),
    client.user.findUnique({ where: { id: userId }, select: { state: true } }),
  ]);
  const forecastBills = upcomingBills(input, LEAN_BILL_DAYS).reduce(
    (sum, b) => sum + b.amountCents,
    0,
  );
  const waitable = buildStreams(input)
    .filter(
      (s) =>
        s.active && s.pfcPrimary && LEAN_WAITABLE_PRIMARIES.includes(s.pfcPrimary) && s.frequency,
    )
    .map((s) => ({
      name: s.merchant,
      monthlyCents: Math.round(s.lastAmountCents * (MONTHLY[s.frequency ?? ""] ?? 1)),
    }));
  const plan = leanPlan({
    cashCents: health.cashCents ?? 0,
    monthlySpendingCents: health.monthlySpendingCents ?? 0,
    forecastBillsCents: forecastBills,
    waitable,
    debts: payoff.book.debts.map((d) => ({ name: d.name, kind: d.kind })),
    stateName: US_STATES.find((s) => s.code === user?.state)?.name ?? null,
  });
  return { plan, message: leanMessage(plan) };
}

// Plans that ended in the last week, for the one "back to normal" message.
export async function recentlyEnded(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<{ id: string; employer: string }[]> {
  return scopedFor(userId, client).leanPlans.findMany({
    where: { status: "ended", endedAt: { gt: new Date(now.getTime() - 7 * 86_400_000) } },
    select: { id: true, employer: true },
  });
}
