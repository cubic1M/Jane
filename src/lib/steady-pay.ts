import {
  MIN_STEADY_MOVE_CENTS,
  STEADY_MONTHS,
  TAX_PAYMENT_SYNC_LAG_DAYS,
  UNEVEN_INCOME_FACT,
} from "@/config/steady-pay";
import { SELF_EMPLOYED_INCOME_CATEGORIES } from "@/config/tax-pack";
import type { PrismaClient } from "@/generated/prisma/client";
import { loadDetectionInput } from "@/detection/input";
import type { DetectionInput } from "@/detection/types";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { healthInput } from "@/lib/health-score";
import { listPreferences } from "@/lib/jane-agent/preferences";
import { moneyPartnerFor, type MoneyMovementPartner } from "@/lib/money-movement/partner";
import { scheduleTransfer, TransferError } from "@/lib/money-movement/transfers";
import { mayAct, recordAct } from "@/lib/sector-autopilot";
import { loadSelfEmployed } from "@/lib/self-employed";
import { steadyPlan, type SteadyPlan } from "@/planning/steady-pay";
import { isoDay as iso } from "@/lib/dates";

// A steady paycheck from uneven income (spec step 240). For freelancers and commission
// earners (contracting or gig deposits, or the person saying so): each deposit has its tax
// share set aside and the rest swept into the buffer (the savings account), and once a month
// a steady "paycheck" goes from the buffer to checking, through step 144's stand-in, within
// the autopilot caps. The plan lives in src/planning/steady-pay.ts and never takes the buffer
// below its floor.

type Options = {
  client?: PrismaClient;
  now?: Date;
  partner?: MoneyMovementPartner | null;
  input?: DetectionInput;
};

const monthOf = (d: Date | string) => (typeof d === "string" ? d : iso(d)).slice(0, 7);

export type SteadyView = {
  uneven: boolean;
  plan: SteadyPlan | null;
  month: string;
  // Already sent this month (the transfer's id and when), or asked and waiting.
  sent: { amountCents: number; runOn: string; by: string } | null;
  setAsideRate: number;
  checkingAccountId: string | null;
  bufferAccountId: string | null;
  bufferCents: number;
  // Tax money set aside into the buffer account this year and not yet paid: not spendable.
  taxReserveCents: number;
};

// Uneven income: contracting or gig deposits in the last year, or the person said so.
async function hasUnevenIncome(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<boolean> {
  const prefs = await listPreferences(userId, { client });
  if (prefs.some((p) => p.kind === "fact" && p.key === UNEVEN_INCOME_FACT)) return true;
  const since = new Date(now.getTime() - 365 * 86_400_000);
  const deposits = await scopedFor(userId, client).transactions.count({
    where: {
      amountCents: { lt: 0 },
      pending: false,
      pfcDetailed: { in: [...SELF_EMPLOYED_INCOME_CATEGORIES] },
      date: { gte: since },
    },
  });
  return deposits >= 3;
}

export async function loadSteady(
  userId: string,
  { client = defaultClient, now = new Date(), input: given }: Options = {},
): Promise<SteadyView | null> {
  const input = given ?? (await loadDetectionInput(userId, { client, now }));
  if (input.accounts.length === 0) return null;
  const uneven = await hasUnevenIncome(userId, { client, now });
  const month = monthOf(input.asOf);
  const checking = input.accounts.find((a) => a.type === "depository" && a.subtype === "checking");
  const buffer = input.accounts.find((a) => a.type === "depository" && a.subtype === "savings");
  const base = {
    uneven,
    month,
    sent: null,
    setAsideRate: 0,
    checkingAccountId: checking?.id ?? null,
    bufferAccountId: buffer?.id ?? null,
    bufferCents: buffer?.currentBalanceCents ?? 0,
    taxReserveCents: 0,
  };
  if (!uneven || !checking || !buffer) return { ...base, plan: null };

  const db = scopedFor(userId, client);
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - STEADY_MONTHS, 1));
  const [rows, health, sent] = await Promise.all([
    db.transactions.findMany({
      where: {
        amountCents: { lt: 0 },
        pending: false,
        pfcDetailed: { in: [...SELF_EMPLOYED_INCOME_CATEGORIES] },
        date: { gte: from, lt: new Date(`${month}-01T00:00:00Z`) },
      },
      select: { date: true, amountCents: true },
    }),
    healthInput(userId, input, { client, now }),
    db.moneyTransfers.findFirst({
      where: {
        planKey: `steady:${month}`,
        status: { in: ["pending", "completed", "awaiting_partner"] },
      },
      select: { amountCents: true, runOn: true, by: true },
    }),
  ]);
  // The last full months, oldest first, empty months counted as nothing.
  const months: number[] = [];
  const first = new Date(from);
  for (let i = 0; i < STEADY_MONTHS; i += 1) {
    const m = monthOf(new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + i, 1)));
    months.push(rows.filter((r) => monthOf(r.date) === m).reduce((s, r) => s - r.amountCents, 0));
  }
  // Months before the first deposit aren't months of this income.
  const start = months.findIndex((c) => c > 0);
  const seen = start === -1 ? [] : months.slice(start);
  const selfEmployed = await loadSelfEmployed(userId, { client, now }).catch(() => null);
  const setAsideRate = selfEmployed?.setAsideRate ?? 0;
  // The tax year runs from February 1 to January 31 (src/lib/tax-estimate.ts): what the tax part
  // of each deposit put into the buffer account in it, and the payments entered for it.
  const taxYear = selfEmployed?.year ?? Number(month.slice(0, 4));
  const setAside = await db.moneyTransfers.findMany({
    where: {
      sector: "taxes",
      toAccountId: buffer.id,
      status: "completed",
      planKey: { startsWith: "deposit:" },
      runOn: {
        gte: new Date(`${taxYear}-02-01T00:00:00Z`),
        lt: new Date(`${taxYear + 1}-02-01T00:00:00Z`),
      },
    },
    select: { amountCents: true },
  });
  // The tax share sits in the same account as the buffer: it isn't spendable, so it is left
  // out of what the paycheck can draw on, less what the person has already paid in.
  // A payment entered in the last few days may not have left the balance yet: not counted yet.
  const syncedBy = new Date(now.getTime() - TAX_PAYMENT_SYNC_LAG_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const paidIn = (selfEmployed?.payments ?? [])
    .filter(
      (p) => p.date >= `${taxYear}-02-01` && p.date <= `${taxYear + 1}-01-31` && p.date <= syncedBy,
    )
    .reduce((sum, p) => sum + p.cents, 0);
  const taxReserveCents = Math.max(0, setAside.reduce((sum, t) => sum + t.amountCents, 0) - paidIn);
  return {
    ...base,
    setAsideRate,
    taxReserveCents,
    sent: sent && { amountCents: sent.amountCents, runOn: iso(sent.runOn), by: sent.by },
    plan: steadyPlan({
      monthlyDepositsCents: seen,
      setAsideRate,
      bufferCents: Math.max(0, base.bufferCents - taxReserveCents),
      monthlySpendingCents: health.monthlySpendingCents ?? 0,
    }),
  };
}

// Each recent deposit: its tax share to the set-aside, the rest to the buffer. Once per
// deposit (planKey), within the caps; what the caps don't allow waits.
async function handleDeposits(
  userId: string,
  view: SteadyView,
  { client = defaultClient, now = new Date(), partner }: Options,
): Promise<number> {
  if (!view.checkingAccountId || !view.bufferAccountId) return 0;
  const selfEmployed = await loadSelfEmployed(userId, { client, now }).catch(() => null);
  if (!selfEmployed) return 0;
  const db = scopedFor(userId, client);
  const goal = await db.savingsGoals.findFirst({
    where: { name: `Taxes set aside for ${selfEmployed.year}` },
    select: { id: true },
  });
  let moved = 0;
  for (const deposit of selfEmployed.recent) {
    const key = `deposit:${deposit.id}`;
    // A part already moved keeps its amount; the other is what is left of the deposit, so a
    // changed estimate can't move more than the deposit in all (CodeRabbit on #2261).
    const moved0 = await db.moneyTransfers.findMany({
      where: { planKey: { in: [`${key}:tax`, `${key}:buffer`] } },
      select: { planKey: true, amountCents: true },
    });
    const done = (suffix: string) => moved0.find((t) => t.planKey === `${key}:${suffix}`);
    const taxCents = done("buffer")
      ? deposit.cents - done("buffer")!.amountCents
      : deposit.setAsideCents;
    const net = done("tax") ? deposit.cents - done("tax")!.amountCents : deposit.cents - taxCents;
    const parts = [
      {
        suffix: "tax",
        cents: taxCents,
        sector: "taxes" as const,
        label: "Taxes set aside",
        goalId: goal?.id ?? null,
      },
      { suffix: "buffer", cents: net, sector: "goals" as const, label: "Buffer", goalId: null },
    ];
    for (const part of parts) {
      if (part.cents < MIN_STEADY_MOVE_CENTS) continue;
      // Each part has its own planKey: one the caps held back is tried again next time.
      const partKey = `${key}:${part.suffix}`;
      if (
        await db.moneyTransfers.findFirst({ where: { planKey: partKey }, select: { id: true } })
      ) {
        continue;
      }
      const allowed = await mayAct(
        userId,
        part.sector,
        { needs: "safe", cents: part.cents },
        { client, now },
      );
      if (!allowed.ok) continue;
      try {
        await scheduleTransfer(
          userId,
          {
            fromAccountId: view.checkingAccountId,
            toAccountId: view.bufferAccountId,
            toName: part.label,
            amountCents: part.cents,
            purpose: "goal",
            sector: part.sector,
            goalId: part.goalId,
            planKey: partKey,
          },
          "autopilot",
          { client, now, partner },
        );
      } catch (error) {
        if (error instanceof TransferError) continue;
        throw error;
      }
      await recordAct(userId, part.sector, part.cents, `${part.label} from a deposit`, {
        client,
        now,
      });
      moved += 1;
    }
  }
  return moved;
}

export class SteadyError extends Error {}

// This month's steady paycheck, from the buffer to checking. By autopilot when its caps allow;
// otherwise it waits for the person (payNow).
export async function runSteadyPay(
  userId: string,
  options: Options = {},
): Promise<{ deposits: number; paycheck: "sent" | "asked" | "none" }> {
  const { client = defaultClient, now = new Date() } = options;
  const movement =
    options.partner === undefined ? await moneyPartnerFor(userId, { client }) : options.partner;
  if (!movement) return { deposits: 0, paycheck: "none" };
  const view = await loadSteady(userId, options);
  if (!view?.plan || !view.checkingAccountId || !view.bufferAccountId) {
    return { deposits: 0, paycheck: "none" };
  }
  const deposits = await handleDeposits(userId, view, { ...options, partner: movement });
  const { plan } = view;
  if (view.sent || plan.status !== "ready" || plan.paycheckCents < MIN_STEADY_MOVE_CENTS) {
    return { deposits, paycheck: "none" };
  }
  const allowed = await mayAct(
    userId,
    "goals",
    { needs: "safe", cents: plan.paycheckCents },
    { client, now },
  );
  if (!allowed.ok) return { deposits, paycheck: "asked" };
  // The amount the caps allowed is the amount sent: if the figures moved in between, nothing
  // is sent and the paycheck waits.
  let sentCents: number;
  try {
    ({ amountCents: sentCents } = await payNow(userId, "autopilot", {
      ...options,
      partner: movement,
      authorizedCents: plan.paycheckCents,
    }));
  } catch (error) {
    if (error instanceof SteadyError) return { deposits, paycheck: "none" };
    throw error;
  }
  await recordAct(userId, "goals", sentCents, "Paid the steady paycheck from the buffer", {
    client,
    now,
  });
  return { deposits, paycheck: "sent" };
}

// The paycheck itself: the plan worked out again at this moment, then the transfer. Refuses
// anything that would take the buffer under its floor.
export async function payNow(
  userId: string,
  by: "autopilot" | "person",
  options: Options & { authorizedCents?: number } = {},
): Promise<{ amountCents: number; runOn: string }> {
  const { client = defaultClient, now = new Date(), partner } = options;
  const view = await loadSteady(userId, options);
  if (!view?.plan || !view.checkingAccountId || !view.bufferAccountId) {
    throw new SteadyError("There's no steady paycheck to send right now.");
  }
  if (view.sent) throw new SteadyError("This month's paycheck was already sent.");
  if (view.plan.status !== "ready" || view.plan.paycheckCents < MIN_STEADY_MOVE_CENTS) {
    throw new SteadyError(view.plan.reason);
  }
  if (
    options.authorizedCents !== undefined &&
    view.plan.paycheckCents !== options.authorizedCents
  ) {
    throw new SteadyError(
      "The paycheck changed since it was checked, so it waits for the next look.",
    );
  }
  try {
    const { runOn } = await scheduleTransfer(
      userId,
      {
        fromAccountId: view.bufferAccountId,
        toAccountId: view.checkingAccountId,
        toName: "Checking (your steady paycheck)",
        amountCents: view.plan.paycheckCents,
        purpose: "goal",
        sector: "goals",
        planKey: `steady:${view.month}`,
      },
      by,
      { client, now, partner },
    );
    return { amountCents: view.plan.paycheckCents, runOn };
  } catch (error) {
    if (error instanceof TransferError) throw new SteadyError(error.message);
    throw error;
  }
}
