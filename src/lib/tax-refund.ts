import { BUDGET_SUGGESTION_MONTHS } from "@/config/budgets";
import { REFUND } from "@/config/tax";
import type { PrismaClient } from "@/generated/prisma/client";
import { loadInsightTransactions } from "@/insights/load";
import { fundProfile, fundTarget } from "@/lib/emergency-fund";
import { typicalMonthlySpending } from "@/insights/typical-month";
import { adviceMode } from "@/lib/advice-mode";
import { track } from "@/lib/analytics";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { addDeadline } from "@/lib/deadlines";
import { addGoal, listGoals } from "@/lib/goals";
import { formatCents } from "@/lib/money";
import { loadTaxEstimate } from "@/lib/tax-estimate";
import {
  findRefunds,
  matchRefund,
  refundPlan,
  type Refund,
  type RefundMatch,
  type RefundPlanItem,
} from "@/planning/tax-refund";

// Tax refunds (spec step 125): spotted when they land, matched to the estimate for their
// year, and (demo advice) a plan for where they could go. "Set it up" adds the goals and
// reminders the plan needs; Jane never moves the money.

type Options = { client?: PrismaClient; now?: Date };

export class RefundError extends Error {}

export type RefundView = {
  refund: Refund;
  match: RefundMatch | null;
  handled: boolean;
  // Demo advice mode only; null otherwise.
  plan: { items: RefundPlanItem[]; leftCents: number } | null;
};

const DAY_MS = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const EMERGENCY_GOAL = "Emergency fund";

async function planInputs(userId: string, client: PrismaClient, now: Date) {
  const db = scopedFor(userId, client);
  const asOf = iso(now);
  const [transactions, savings, cards, goals] = await Promise.all([
    loadInsightTransactions(db, asOf, BUDGET_SUGGESTION_MONTHS + 1),
    db.accounts.findMany({
      where: { type: "depository", subtype: { in: ["savings", "money market", "cd"] } },
      select: { currentBalanceCents: true },
    }),
    db.liabilities.findMany({
      where: { kind: "credit" },
      select: { aprBps: true, account: { select: { name: true, currentBalanceCents: true } } },
    }),
    listGoals(userId, { client, now }),
  ]);
  const monthly = typicalMonthlySpending(transactions, asOf, BUDGET_SUGGESTION_MONTHS);
  // Their own emergency fund goal, else the fund sized for them, as on the cash page.
  const goal = goals.find((g) => /emergency/i.test(g.name));
  return {
    emergency: {
      targetCents:
        goal?.targetCents ??
        fundTarget(monthly, await fundProfile(userId, { client, now }))?.targetCents ??
        0,
      haveCents: savings.reduce((s, a) => s + Math.max(0, a.currentBalanceCents ?? 0), 0),
    },
    debts: cards.map((c) => ({
      accountName: c.account.name,
      balanceCents: Math.max(0, c.account.currentBalanceCents ?? 0),
      aprBps: c.aprBps ?? 0,
    })),
    goals: goals.map((g) => ({
      id: g.id,
      name: g.name,
      leftCents: g.progress.status === "reached" ? 0 : g.progress.leftCents,
      behind: g.progress.status !== "reached",
    })),
  };
}

export async function loadRefunds(
  userId: string,
  { client = defaultClient, now = new Date(), days = 400 }: Options & { days?: number } = {},
): Promise<{ advice: boolean; refunds: RefundView[] }> {
  const db = scopedFor(userId, client);
  const [deposits, profile, advice] = await Promise.all([
    db.transactions.findMany({
      where: {
        pending: false,
        amountCents: { lt: 0 },
        date: { gte: new Date(now.getTime() - days * DAY_MS) },
      },
      select: {
        id: true,
        date: true,
        amountCents: true,
        description: true,
        merchantName: true,
        pfcDetailed: true,
      },
    }),
    db.taxProfiles.findFirst({ select: { refundsHandled: true } }),
    adviceMode(userId, { client }),
  ]);
  const refunds = findRefunds(deposits.map((t) => ({ ...t, date: iso(t.date) })));
  if (refunds.length === 0) return { advice, refunds: [] };
  const handled = new Set(profile?.refundsHandled ?? []);
  // The plan's inputs and each refund year's estimate, together.
  const years = [...new Set(refunds.map((r) => r.taxYear))];
  const [inputs, perYear] = await Promise.all([
    advice ? planInputs(userId, client, now) : null,
    Promise.all(years.map((year) => loadTaxEstimate(userId, { client, now, year }))),
  ]);
  const estimates = new Map(years.map((year, i) => [year, perYear[i]]));
  return {
    advice,
    refunds: refunds.map((refund) => {
      const e = estimates.get(refund.taxYear)!;
      const estimated = e.withholdingKnown
        ? refund.to === "federal"
          ? e.estimate.refundCents
          : (e.estimate.state?.refundCents ?? null)
        : null;
      return {
        refund,
        match: matchRefund(refund.cents, estimated),
        handled: handled.has(refund.transactionId),
        plan: inputs ? refundPlan({ cents: refund.cents, ...inputs }) : null,
      };
    }),
  };
}

async function markHandled(userId: string, transactionId: string, client: PrismaClient) {
  const db = scopedFor(userId, client);
  const profile = await db.taxProfiles.findFirst({ select: { refundsHandled: true } });
  const list = [...new Set([...(profile?.refundsHandled ?? []), transactionId])];
  await db.taxProfiles.upsert({
    where: { userId },
    create: { userId, refundsHandled: list },
    update: { refundsHandled: list },
  });
}

// "Set it up": the goals and reminders the plan needs, for the person to move the money.
export async function applyRefundPlan(
  userId: string,
  transactionId: string,
  { client = defaultClient, now = new Date(), via }: Options & { via: "chat" | "page" },
): Promise<{ reminders: number }> {
  const { advice, refunds } = await loadRefunds(userId, { client, now });
  if (!advice) throw new RefundError("That's only offered in demo advice mode.");
  const view = refunds.find((r) => r.refund.transactionId === transactionId);
  if (!view || !view.plan) throw new RefundError("That refund isn't there anymore.");
  if (view.handled) throw new RefundError("You've already set this one up.");
  const due = iso(new Date(now.getTime() + 3 * DAY_MS));
  const goals = await listGoals(userId, { client, now });
  let reminders = 0;
  for (const item of view.plan.items) {
    if (item.kind === "emergency" && !goals.some((g) => /emergency/i.test(g.name))) {
      const inputs = await planInputs(userId, client, now);
      await addGoal(
        userId,
        {
          name: EMERGENCY_GOAL,
          target: (inputs.emergency.targetCents / 100).toFixed(2),
          targetDate: iso(new Date(now.getTime() + 365 * DAY_MS)),
          accountId: "",
          saved: "",
        },
        { client },
      );
    }
    const title =
      item.kind === "emergency"
        ? `Move ${formatCents(item.cents)} of your refund to savings`
        : item.kind === "debt"
          ? `Pay ${formatCents(item.cents)} toward the ${item.accountName}`
          : `Put ${formatCents(item.cents)} toward "${item.goalName}"`;
    await addDeadline(
      userId,
      { title, dueOn: due, kind: "other", note: "From your tax refund." },
      { client, now },
    );
    reminders += 1;
  }
  await markHandled(userId, transactionId, client);
  await track(userId, "tax_refund_plan_set_up", { items: reminders, via });
  return { reminders };
}

export async function dismissRefund(
  userId: string,
  transactionId: string,
  { client = defaultClient, via }: Options & { via: "chat" | "page" },
): Promise<void> {
  await markHandled(userId, transactionId, client);
  await track(userId, "tax_refund_plan_dismissed", { via });
}

export const recentRefund = (refunds: RefundView[], now: Date) =>
  refunds.find(
    (r) =>
      !r.handled &&
      Date.parse(`${r.refund.date}T00:00:00Z`) >= now.getTime() - REFUND.recentDays * DAY_MS,
  ) ?? null;
