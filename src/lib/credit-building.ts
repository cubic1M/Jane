import { STATEMENT_CUSHION_CENTS, STREAK_LOOKBACK_DAYS } from "@/config/credit-building";
import type { PrismaClient } from "@/generated/prisma/client";
import {
  DEMO_CREDIT_BUILDERS,
  type CreditBuilderProduct,
} from "@/data-sources/demo/demo-credit-builders";
import type { DebtBook } from "@/insights/debts";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { creditPartnerFor } from "@/lib/credit";
import type { CreditRequest } from "@/lib/credit/partner";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { debtsOr } from "@/lib/debts";
import { moneyPartnerFor } from "@/lib/money-movement/partner";
import { scheduleTransfer, TransferError } from "@/lib/money-movement/transfers";
import { autopilotFor, mayAct, recordAct } from "@/lib/sector-autopilot";
import {
  onTimeStreak,
  simulations,
  statementAmount,
  statementPlan,
  thinFile,
  type SimulationKey,
  type StatementPlan,
  type Streak,
} from "@/planning/credit-building";
import { DAY_MS, isoDay } from "@/lib/dates";

// Building credit (spec step 175). Before a card's statement closes Jane works out what to
// pay so a lower balance is reported: from "Handle the safe stuff" it schedules it by
// itself through the money-movement stand-in within the debt autopilot's caps, otherwise
// it reminds with one tap. It counts the on-time streak, offers a credit-builder stand-in
// for a thin file, and estimates the score after each change with the credit partner's
// simulator, always labelled an estimate. Only demo-bank people: nothing changes a real
// account.

type Options = { client?: PrismaClient; now?: Date };

export const statementKey = (accountId: string, closesOn: string) =>
  `statement:${accountId}:${closesOn}`;

export class CreditBuildingError extends Error {}

export type StatementView = StatementPlan & {
  accountId: string;
  cardName: string;
  // What Jane would pay: under 10% when checking can spare it, else under 30%.
  suggested: { amountCents: number; target: "good" | "high" } | null;
  // Already scheduled for this statement, by Jane or the person.
  scheduled: { amountCents: number; runOn: string; by: string } | null;
  // Moving money is possible (the stand-in, for the demo bank).
  canPay: boolean;
};

export type CreditBuilding = {
  available: boolean;
  level: "ask" | "safe" | "all";
  score: number | null;
  statement: StatementView | null;
  streak: Streak | null;
  thin: boolean;
  // The simulator: an estimate of the score after each change.
  estimates: { key: SimulationKey; label: string; score: number; change: number }[];
  builders: CreditBuilderProduct[];
};

const none: CreditBuilding = {
  available: false,
  level: "ask",
  score: null,
  statement: null,
  streak: null,
  thin: false,
  estimates: [],
  builders: [],
};

async function checkingOf(userId: string, client: PrismaClient) {
  const accounts = await scopedFor(userId, client).accounts.findMany({
    where: { type: "depository", subtype: "checking" },
    select: { id: true, currentBalanceCents: true, availableBalanceCents: true },
    orderBy: { id: "asc" },
  });
  const a = accounts[0];
  return a
    ? { id: a.id, balanceCents: a.availableBalanceCents ?? a.currentBalanceCents ?? 0 }
    : null;
}

export async function loadCreditBuilding(
  userId: string,
  { client = defaultClient, now = new Date(), book: given }: Options & { book?: DebtBook } = {},
): Promise<CreditBuilding> {
  const found = await creditPartnerFor(userId, { client });
  if (!found) return none;
  const asOf = isoDay(now);
  const db = scopedFor(userId, client);
  const [book, report, lateFees, first, setting, checking, mover] = await Promise.all([
    debtsOr(given, userId, { client, now }),
    db.creditReports.findFirst({
      orderBy: [{ pulledOn: "desc" }, { createdAt: "desc" }],
    }),
    db.transactions.findMany({
      where: {
        date: { gte: new Date(now.getTime() - STREAK_LOOKBACK_DAYS * DAY_MS) },
        amountCents: { gt: 0 },
        pfcDetailed: "BANK_FEES_LATE_FEES",
      },
      select: { date: true },
    }),
    db.transactions.findFirst({ select: { date: true }, orderBy: { date: "asc" } }),
    autopilotFor(userId, "debt", { client, now }),
    checkingOf(userId, client),
    moneyPartnerFor(userId, { client }),
  ]);
  const historyStart = first
    ? isoDay(
        new Date(Math.max(first.date.getTime(), now.getTime() - STREAK_LOOKBACK_DAYS * DAY_MS)),
      )
    : asOf;
  const streak = onTimeStreak(
    lateFees.map((t) => isoDay(t.date)),
    book.debts.some((d) => d.overdue),
    asOf,
    historyStart,
  );
  if (!report) {
    return { ...none, available: true, level: setting.level, streak };
  }
  const request = report.inputs as unknown as CreditRequest;

  // The card with the most on it, and its coming statement.
  let statement: StatementView | null = null;
  const card = book.debts
    .filter((d) => d.kind === "card" && d.inNetWorth && d.accountId && (d.balanceCents ?? 0) > 0)
    .sort((a, b) => (b.balanceCents ?? 0) - (a.balanceCents ?? 0))[0];
  if (card) {
    const liability = await db.liabilities.findFirst({
      where: { accountId: card.accountId! },
      select: { lastStatementIssueDate: true },
    });
    const plan = liability?.lastStatementIssueDate
      ? statementPlan({
          lastIssue: isoDay(liability.lastStatementIssueDate),
          asOf,
          balanceCents: request.cardBalanceCents,
          limitCents: report.cardLimitCents,
        })
      : null;
    if (plan) {
      const done = await db.moneyTransfers.findFirst({
        where: {
          planKey: statementKey(card.accountId!, plan.closesOn),
          status: { in: ["pending", "completed"] },
        },
        select: { amountCents: true, runOn: true, by: true },
      });
      const spare = checking ? checking.balanceCents - STATEMENT_CUSHION_CENTS : 0;
      statement = {
        ...plan,
        accountId: card.accountId!,
        cardName: card.name,
        suggested: statementAmount(plan, spare),
        scheduled: done && {
          amountCents: done.amountCents,
          runOn: isoDay(done.runOn),
          by: done.by,
        },
        canPay: mover !== null && checking !== null,
      };
    }
  }

  const creditAccounts = book.debts.filter(
    (d) => d.inNetWorth && ["card", "student", "auto", "mortgage", "loan"].includes(d.kind),
  ).length;
  const thin = thinFile(creditAccounts, report.averageAgeMonths);
  const estimates = [];
  for (const s of simulations(request, report.cardLimitCents, { thin })) {
    const score = await found.partner.estimate(request, s.change);
    estimates.push({ key: s.key, label: s.label, score, change: score - report.score });
  }
  return {
    available: true,
    level: setting.level,
    score: report.score,
    statement,
    streak,
    thin,
    estimates,
    builders: thin ? [...DEMO_CREDIT_BUILDERS] : [],
  };
}

async function schedule(
  userId: string,
  s: StatementView,
  amountCents: number,
  by: "autopilot" | "person",
  { client, now }: { client: PrismaClient; now: Date },
) {
  const checking = await checkingOf(userId, client);
  if (!checking) throw new CreditBuildingError("There's no checking account to pay from.");
  return scheduleTransfer(
    userId,
    {
      fromAccountId: checking.id,
      toAccountId: s.accountId,
      toName: s.cardName,
      amountCents,
      purpose: "debt",
      sector: "debt",
      planKey: statementKey(s.accountId, s.closesOn),
      runOn: s.payOn,
    },
    by,
    { client, now },
  );
}

// Jane's own step before its brain looks: from "Handle the safe stuff", the payment before
// the statement closes, within the debt autopilot's caps. True when it scheduled it.
export async function runCreditBuilding(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<boolean> {
  const data = await loadCreditBuilding(userId, { client, now });
  const s = data.statement;
  if (!s || !s.due || s.scheduled || !s.canPay || data.level === "ask") return false;
  const checking = await checkingOf(userId, client);
  const spare = (checking?.balanceCents ?? 0) - STATEMENT_CUSHION_CENTS;
  // The largest target that fits checking's cushion and the debt caps.
  for (const amountCents of [s.toUnderGoodCents, s.toUnderHighCents]) {
    if (amountCents <= 0 || amountCents > spare) continue;
    const may = await mayAct(
      userId,
      "debt",
      { needs: "safe", cents: amountCents },
      { client, now },
    );
    if (!may.ok) continue;
    await schedule(userId, s, amountCents, "autopilot", { client, now });
    await recordAct(userId, "debt", amountCents, `Paid ${s.cardName} before its statement`, {
      client,
      now,
    });
    await track(userId, "statement_payment_scheduled", { by: "autopilot" });
    return true;
  }
  return false;
}

// The person tapped Pay: the suggested amount before the statement closes.
export async function payBeforeStatement(
  userId: string,
  target: { accountId: string; closesOn: string },
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<{ amountCents: number; runOn: string; cardName: string; closesOn: string }> {
  const data = await loadCreditBuilding(userId, { client, now });
  const s = data.statement;
  if (!s || s.accountId !== target.accountId || s.closesOn !== target.closesOn) {
    throw new CreditBuildingError("That statement has already closed.");
  }
  if (s.scheduled) {
    throw new CreditBuildingError(`It's already scheduled for ${s.scheduled.runOn}.`);
  }
  if (!s.canPay)
    throw new CreditBuildingError("Moving money isn't available for your accounts yet.");
  if (!s.suggested) {
    throw new CreditBuildingError(
      "Checking can't spare it right now without going under its cushion.",
    );
  }
  try {
    const t = await schedule(userId, s, s.suggested.amountCents, "person", { client, now });
    await track(userId, "statement_payment_scheduled", { by: "person" });
    return {
      amountCents: s.suggested.amountCents,
      runOn: t.runOn,
      cardName: s.cardName,
      closesOn: s.closesOn,
    };
  } catch (error) {
    if (error instanceof TransferError) throw new CreditBuildingError(error.message);
    throw error;
  }
}

// The person tapped Open for a credit-builder stand-in (a thin file only). Audited.
export async function applyForBuilder(
  userId: string,
  productId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<{ id: string; product: CreditBuilderProduct }> {
  const data = await loadCreditBuilding(userId, { client, now });
  const product = data.builders.find((b) => b.id === productId);
  if (!product) throw new CreditBuildingError("That isn't offered to you.");
  const db = scopedFor(userId, client);
  if (await db.cardApplications.findFirst({ where: { productId }, select: { id: true } })) {
    throw new CreditBuildingError(`You've already opened the ${product.name}.`);
  }
  const row = await db.cardApplications.create({
    data: {
      userId,
      partner: "demo",
      productId: product.id,
      issuer: product.issuer,
      cardName: product.name,
      annualFeeCents: product.kind === "secured_card" ? product.costCents : 0,
      status: "approved",
      partnerApplicationId: `demo-builder-${crypto.randomUUID()}`,
      createdAt: now,
    },
    select: { id: true },
  });
  await logAudit(
    { type: "user", id: userId },
    "card_application_submitted",
    { type: "card_application", id: row.id },
    { issuer: product.issuer, card: product.name, status: "approved", builder: true },
  );
  await track(userId, "credit_builder_opened", { product: product.id });
  return { id: row.id, product };
}
