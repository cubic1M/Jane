import {
  CLAIM_LEASE_MS,
  DEFAULT_PAYCHECKS_PER_MONTH,
  PAYCHECK_BUFFER_MARGIN_CENTS,
  PAYCHECK_CUSHION_CENTS,
  PAYCHECK_FORECAST_DAYS,
  PAYCHECK_PLAN_DAYS,
} from "@/config/money-movement";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { loadDetectionInput } from "@/detection/input";
import type { DetectionInput } from "@/detection/types";
import { addDays, daysBetween, median } from "@/detection/units";
import { PAYCHECKS_PER_MONTH } from "@/config/detection";
import { paySchedules } from "@/detection/paydays";
import { employers } from "@/insights/changes";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { loadPayoff } from "@/lib/debt-plan";
import { leanActive } from "@/lib/lean-plan";
import { forecastAccounts } from "@/detection/forecast";
import { listGoals } from "@/lib/goals";
import { homeSummary } from "@/lib/home";
import { mayAct, recordAct } from "@/lib/sector-autopilot";
import { payoffOrder } from "@/planning/debt";
import { paycheckPlan, type PlannedMove } from "@/planning/paycheck-plan";
import { moneyPartnerFor, type MoneyMovementPartner } from "./partner";
import { cancelTransfer, scheduleTransfer, TransferError } from "./transfers";
import { isoDay as iso } from "@/lib/dates";

// Money that moves itself (spec step 144). When a paycheck lands, Jane works out its plan
// (src/planning/paycheck-plan.ts) and, through the money-movement partner, moves each part
// on its own where its sector's autopilot allows it and the amount fits the caps (step 141);
// the rest waits for one tap. Every transfer is on /transfers and can be undone while
// pending. Only with a partner: the stand-in for demo-bank people, nobody else yet.

// A paycheck plan claimed and not finished within this long is picked up again by the next run.
const PAYCHECK_CLAIM_MS = 10 * 60 * 1000;

type Options = { client?: PrismaClient; now?: Date; partner?: MoneyMovementPartner | null };

export type PlanMove = PlannedMove & {
  status: "moved" | "auto" | "asked" | "skipped";
  transferId?: string;
};

export type PaycheckPlanView = {
  id: string;
  key: string;
  paycheckCents: number;
  paidOn: string;
  status: string;
  moves: PlanMove[];
  // Spec step 206: what stayed for bills, the buffer, and went to investing.
  kept: { billsCents: number; bufferCents: number; investingCents: number } | null;
};

// The key one move of a plan holds in money_transfers.unique_key: the same move scheduled twice
// is one transfer.
const moveKey = (planKey: string, move: Pick<PlannedMove, "purpose" | "toAccountId" | "goalId">) =>
  `${planKey}|${move.purpose}|${move.toAccountId ?? ""}|${move.goalId ?? ""}`;

// A transfer this plan already saved for the same move: a retry after a crash reuses it instead of
// scheduling the money a second time.
async function savedTransfer(
  db: ReturnType<typeof scopedFor>,
  planKey: string,
  move: Pick<PlannedMove, "purpose" | "toAccountId" | "goalId">,
) {
  return db.moneyTransfers.findFirst({
    where: {
      planKey,
      purpose: move.purpose,
      toAccountId: move.toAccountId ?? null,
      goalId: move.goalId ?? null,
      status: { in: ["pending", "awaiting_partner", "releasing", "completed"] },
      // Saved ahead of the partner call and never answered is not a scheduled move.
      OR: [{ partnerRef: { not: null } }, { status: "awaiting_partner" }],
    },
    select: { id: true },
  });
}

const movesOf = (value: Prisma.JsonValue): PlanMove[] =>
  Array.isArray(value) ? (value as unknown as PlanMove[]) : [];

// The newest paycheck in the last few days, and how many come in a month.
export function latestPaycheck(input: DetectionInput) {
  const from = addDays(input.asOf, -PAYCHECK_PLAN_DAYS);
  let latest: { id: string; date: string; cents: number; perMonth: number } | null = null;
  const schedules = paySchedules(input);
  for (const employer of employers(input)) {
    const last = employer.deposits.at(-1)!;
    if (last.date <= from || last.date > input.asOf) continue;
    if (latest && last.date <= latest.date) continue;
    // From the employer's pay schedule (spec step 182): a weekly paycheck comes 4.33 times a
    // month, not 4. Without a schedule yet, from the usual gap.
    const schedule = schedules.find((x) => x.key === `employer:${employer.key}`);
    const gaps = employer.deposits
      .slice(1)
      .map((d, i) => daysBetween(employer.deposits[i].date, d.date));
    const perMonth = schedule
      ? PAYCHECKS_PER_MONTH[schedule.frequency]
      : gaps.length > 0
        ? Math.max(1, Math.round(30 / median(gaps)))
        : DEFAULT_PAYCHECKS_PER_MONTH;
    latest = { id: last.id, date: last.date, cents: -last.amountCents, perMonth };
  }
  return latest;
}

async function payoffDebt(userId: string, client: PrismaClient, now: Date) {
  const payoff = await loadPayoff(userId, { client, now });
  const stored = payoff.stored;
  if (!stored || stored.extraCents <= 0) return null;
  const [first] = payoffOrder(payoff.summary.cards, stored.strategy);
  if (!first?.id.startsWith("account:")) return null;
  return {
    accountId: first.id.slice("account:".length),
    name: first.name,
    extraCents: stored.extraCents,
  };
}

// After a paycheck: the plan, once, and what autopilot may move of it. Returns the plan.
export async function runPaycheckPlan(
  userId: string,
  {
    client = defaultClient,
    now = new Date(),
    partner,
    input,
  }: Options & { input?: DetectionInput } = {},
): Promise<PaycheckPlanView | null> {
  const movement = partner === undefined ? await moneyPartnerFor(userId, { client }) : partner;
  if (!movement) return null;
  // Spec step 204: while the lean plan is in force, nothing moves by itself.
  if (await leanActive(userId, { client })) return null;
  const loaded = input ?? (await loadDetectionInput(userId, { client, now }));
  const paycheck = latestPaycheck(loaded);
  if (!paycheck) return null;
  const key = `paycheck:${paycheck.id}`;
  const db = scopedFor(userId, client);
  const existing = await db.paycheckPlans.findFirst({ where: { key } });
  // A plan another run is still working on is left to it; one claimed and never finished is
  // picked up again, and the moves it already saved are reused below.
  if (existing && existing.status !== "claimed") return viewOf(existing);
  if (existing) {
    // An unfinished claim is taken over only when it has gone quiet, and by one run: the takeover
    // renews the claim's time, so a second run that read the same row finds it fresh and stops.
    if (now.getTime() - existing.createdAt.getTime() < PAYCHECK_CLAIM_MS) return null;
    const took = await db.paycheckPlans.updateMany({
      where: { id: existing.id, status: "claimed", createdAt: existing.createdAt },
      data: { createdAt: now },
    });
    if (took.count === 0) return null;
  }

  const checking = loaded.accounts.find((a) => a.type === "depository" && a.subtype === "checking");
  const home = await homeSummary(userId, { client, now });
  const safe = home?.safeToSpend;
  if (!checking || !safe) return null;
  const savings = loaded.accounts.find((a) => a.type === "depository" && a.subtype === "savings");
  const [goals, debt] = await Promise.all([
    listGoals(userId, { client, now }),
    payoffDebt(userId, client, now),
  ]);
  // Spec step 206: what can leave checking and still keep its forecast low above the margin
  // (transfers already pending count as gone).
  const lowest = forecastAccounts(loaded, PAYCHECK_FORECAST_DAYS).find(
    (f) => f.accountId === checking.id,
  )?.lowest.balanceCents;
  // No forecast for this account (no balance of its own): nothing is known about what can leave it,
  // and "no limit" is not an answer (CodeRabbit sweep).
  if (lowest === undefined) return null;
  const pendingOut = (
    await db.moneyTransfers.findMany({
      where: { status: "pending", fromAccountId: checking.id },
      select: { amountCents: true },
    })
  ).reduce((s, t) => s + t.amountCents, 0);
  const invested =
    (
      await db.autoInvestRuns.findFirst({
        where: { status: "invested", paydayOn: new Date(`${paycheck.date}T00:00:00Z`) },
        select: { amountCents: true },
      })
    )?.amountCents ?? 0;
  const plan = paycheckPlan({
    forecastRoomCents: Math.max(0, lowest - pendingOut - PAYCHECK_BUFFER_MARGIN_CENTS),
    investedCents: invested,
    paycheckCents: paycheck.cents,
    paychecksPerMonth: paycheck.perMonth,
    checkingAccountId: checking.id,
    savingsAccount: savings ? { id: savings.id, name: savings.name } : null,
    accountNames: Object.fromEntries(loaded.accounts.map((a) => [a.id, a.name])),
    balanceCents: safe.balanceCents,
    billsCents: safe.billsCents,
    budgetsLeftCents: safe.budgetsLeftCents,
    safeCents: safe.safeCents,
    cushionCents: PAYCHECK_CUSHION_CENTS,
    goals: goals.map((g) => ({
      id: g.id,
      name: g.name,
      monthlyCents: g.progress.status === "on_the_way" ? g.progress.monthlyCents : 0,
      accountId: g.accountId,
      onTheWay: g.progress.status === "on_the_way",
    })),
    debt,
  });
  // Claim the paycheck before anything is scheduled: of two runs at once only one gets the row,
  // and the other stops here instead of scheduling the same moves again.
  if (!existing) {
    try {
      await db.paycheckPlans.create({
        data: {
          userId,
          key,
          paycheckCents: paycheck.cents,
          paidOn: new Date(`${paycheck.date}T00:00:00Z`),
          moves: [],
          status: "claimed",
          createdAt: now,
        },
      });
    } catch (error) {
      if ((error as { code?: string }).code === "P2002") return null;
      throw error;
    }
  }
  // Autopilot first: each move its sector allows, within the caps, now.
  const moves: PlanMove[] = [];
  for (const move of plan.moves) {
    const saved = await savedTransfer(db, key, move);
    if (saved) {
      moves.push({ ...move, status: "auto", transferId: saved.id });
      continue;
    }
    const allowed = await mayAct(
      userId,
      move.sector,
      { needs: move.needs, cents: move.cents },
      { client, now },
    );
    if (!allowed.ok) {
      moves.push({ ...move, status: "asked" });
      continue;
    }
    const { id } = await scheduleTransfer(
      userId,
      { ...move, amountCents: move.cents, planKey: key, uniqueKey: moveKey(key, move) },
      "autopilot",
      {
        client,
        now,
        partner: movement,
      },
    );
    await recordAct(userId, move.sector, move.cents, `Moved ${move.label} from a paycheck`, {
      client,
      now,
    });
    moves.push({ ...move, status: "auto", transferId: id });
  }
  const asked = moves.filter((m) => m.status === "asked").length;
  const status =
    moves.length === 0
      ? "skipped"
      : asked === 0
        ? "auto"
        : asked === moves.length
          ? "proposed"
          : "partial";
  await db.paycheckPlans.updateMany({
    where: { key, status: "claimed" },
    data: {
      moves: moves as unknown as Prisma.InputJsonArray,
      summary: {
        billsCents: plan.wentTo.billsCents,
        bufferCents: plan.wentTo.bufferCents,
        investingCents: plan.wentTo.investingCents,
      },
      status,
    },
  });
  const row = await db.paycheckPlans.findFirstOrThrow({ where: { key } });
  return viewOf(row);
}

function viewOf(row: {
  id: string;
  key: string;
  paycheckCents: number;
  paidOn: Date;
  status: string;
  moves: Prisma.JsonValue;
  summary?: Prisma.JsonValue;
}): PaycheckPlanView {
  return {
    id: row.id,
    key: row.key,
    paycheckCents: row.paycheckCents,
    paidOn: iso(row.paidOn),
    status: row.status,
    moves: movesOf(row.moves),
    kept:
      row.summary && typeof row.summary === "object" && !Array.isArray(row.summary)
        ? (row.summary as unknown as PaycheckPlanView["kept"])
        : null,
  };
}

export class PaycheckError extends Error {}

// "Move them": the person's one tap for what autopilot didn't move.
export async function movePaycheckPlan(
  userId: string,
  planId: string,
  { client = defaultClient, now = new Date(), partner }: Options = {},
): Promise<{ moves: PlanMove[]; scheduled: PlanMove[]; skipped: PlanMove[] }> {
  const db = scopedFor(userId, client);
  const row = await db.paycheckPlans.findFirst({ where: { id: planId } });
  // A plan a tap left "moving" with its hold past its end (the tap died) is taken over.
  const heldPastEnd = !row?.claimExpiresAt || row.claimExpiresAt < now;
  if (
    !row ||
    !(
      row.status === "proposed" ||
      row.status === "partial" ||
      (row.status === "moving" && heldPastEnd)
    )
  ) {
    throw new PaycheckError("That paycheck's plan was already answered.");
  }
  // Claim the answer before scheduling anything: a second Move, or a Skip, now finds the plan
  // taken and stops. The claim is a lease: a second tap while the first still runs stops, and
  // one after the first has gone quiet takes the plan over.
  const claimed = await db.paycheckPlans.updateMany({
    where: {
      id: planId,
      status: row.status,
      ...(row.status === "moving"
        ? { OR: [{ claimExpiresAt: null }, { claimExpiresAt: { lt: now } }] }
        : {}),
    },
    data: { status: "moving", claimExpiresAt: new Date(now.getTime() + CLAIM_LEASE_MS) },
  });
  if (claimed.count === 0) throw new PaycheckError("That paycheck's plan was already answered.");
  const moves = movesOf(row.moves);
  const done: PlanMove[] = [];
  // What this tap did, apart from what autopilot had already moved.
  const scheduled: PlanMove[] = [];
  const skipped: PlanMove[] = [];
  try {
    for (const move of moves) {
      if (move.status !== "asked") {
        done.push(move);
        continue;
      }
      const saved = await savedTransfer(db, row.key, move);
      if (saved) {
        const moved: PlanMove = { ...move, status: "moved", transferId: saved.id };
        done.push(moved);
        scheduled.push(moved);
        continue;
      }
      try {
        const { id } = await scheduleTransfer(
          userId,
          { ...move, amountCents: move.cents, planKey: row.key, uniqueKey: moveKey(row.key, move) },
          "person",
          {
            client,
            now,
            partner,
          },
        );
        const moved: PlanMove = { ...move, status: "moved", transferId: id };
        done.push(moved);
        scheduled.push(moved);
      } catch (error) {
        if (!(error instanceof TransferError)) throw error;
        const left: PlanMove = { ...move, status: "skipped" };
        done.push(left);
        skipped.push(left);
      }
    }
    await db.paycheckPlans.updateMany({
      where: { id: planId },
      data: {
        moves: done as unknown as Prisma.InputJsonArray,
        status: "moved",
        claimExpiresAt: null,
      },
    });
  } catch (error) {
    // Open the plan again for a retry (also when only the final write failed); a move already
    // saved is found and reused then.
    await db.paycheckPlans.updateMany({
      where: { id: planId, status: "moving" },
      data: { status: row.status, claimExpiresAt: null },
    });
    throw error;
  }
  return { moves: done, scheduled, skipped };
}

// "Not this time": nothing more moves for this paycheck.
export async function skipPaycheckPlan(
  userId: string,
  planId: string,
  { client = defaultClient }: Options = {},
) {
  const { count } = await scopedFor(userId, client).paycheckPlans.updateMany({
    where: { id: planId, status: { in: ["proposed", "partial"] } },
    data: { status: "skipped" },
  });
  if (count === 0) throw new PaycheckError("That paycheck's plan was already answered.");
}

// "Undo": every transfer from this paycheck that's still pending.
export async function undoPaycheckPlan(
  userId: string,
  planId: string,
  { client = defaultClient, now = new Date(), partner }: Options = {},
): Promise<{ cancelled: number; remaining: number }> {
  const db = scopedFor(userId, client);
  const row = await db.paycheckPlans.findFirst({ where: { id: planId }, select: { key: true } });
  if (!row) throw new PaycheckError("That paycheck's plan isn't there anymore.");
  const pending = await db.moneyTransfers.findMany({
    // Both: a transfer waiting on the partner is cancelled the same way (cancelTransfer).
    where: { planKey: row.key, status: { in: ["pending", "awaiting_partner", "releasing"] } },
    select: { id: true },
  });
  let cancelled = 0;
  // Ones that could not be cancelled but have not gone through yet (the day passed, or the
  // partner is already processing them): they still go, so Undo stays offered and says so.
  let remaining = 0;
  for (const t of pending) {
    try {
      await cancelTransfer(userId, t.id, { client, now, partner });
      cancelled += 1;
    } catch (error) {
      if (!(error instanceof TransferError)) throw error;
      const still = await db.moneyTransfers.count({
        where: { id: t.id, status: { in: ["pending", "awaiting_partner", "releasing"] } },
      });
      if (still > 0) remaining += 1;
    }
  }
  if (cancelled === 0 && remaining === 0) {
    throw new PaycheckError("Those transfers have already gone through.");
  }
  return { cancelled, remaining };
}

// The newest plan, for the chat and Claude.
export async function latestPaycheckPlan(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<PaycheckPlanView | null> {
  const row = await scopedFor(userId, client).paycheckPlans.findFirst({
    where: {
      paidOn: { gte: new Date(`${addDays(iso(now), -PAYCHECK_PLAN_DAYS * 3)}T00:00:00Z`) },
      // A plan still being worked out is not one to show.
      status: { not: "claimed" },
    },
    orderBy: { paidOn: "desc" },
  });
  return row ? viewOf(row) : null;
}
