import { randomUUID } from "node:crypto";
import { MIN_PAYCHECK_CENTS, PAYCHECK_LOOKBACK_DAYS } from "@/config/auto-invest";
import { EMPLOYER_PLAN_SUBTYPES, FUND_NAMES } from "@/config/funds";
import type { PrismaClient } from "@/generated/prisma/client";
import { adviceMode } from "@/lib/advice-mode";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { brokeragePartner } from "@/lib/brokerage/partner";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { homeSummary } from "@/lib/home";
import { syncDemoInvestments } from "@/lib/plaid/sync";
import {
  contributionBuys,
  decideContribution,
  suggestedAmount,
  type AutoInvestMode,
} from "@/planning/auto-invest";
import { profileSummary } from "@/planning/investor-profile";
import { profileOf } from "./profile";

// Automatic investing (spec step 134). Set up once with a tap (an amount every payday, or
// the rest after bills and goals); after that Jane runs it by herself on each new paycheck,
// at every autopilot level, through the brokerage partner (the simulation until a real one
// is connected), and pauses that payday by herself when safe to spend is low. Every payday
// is recorded, invested or paused, and shown. Demo advice mode with a finished profile only.

type Options = { client?: PrismaClient; now?: Date };

export class AutoInvestError extends Error {}

const DAY_MS = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const isEmployerPlan = (subtype: string | null) =>
  EMPLOYER_PLAN_SUBTYPES.includes((subtype ?? "").toLowerCase());

// Accounts money can be paid into: investment accounts that aren't an employer plan (those
// are paid into from payroll).
async function payableAccounts(userId: string, client: PrismaClient) {
  const accounts = await scopedFor(userId, client).accounts.findMany({
    where: { type: "investment" },
    select: { id: true, name: true, subtype: true },
    orderBy: { name: "asc" },
  });
  return accounts.filter((a) => !isEmployerPlan(a.subtype));
}

// The most recent paycheck, if one came in lately.
async function latestPaycheck(userId: string, client: PrismaClient, now: Date) {
  return scopedFor(userId, client).transactions.findFirst({
    where: {
      pfcPrimary: "INCOME",
      amountCents: { lte: -MIN_PAYCHECK_CENTS },
      date: { gte: new Date(now.getTime() - PAYCHECK_LOOKBACK_DAYS * DAY_MS), lte: now },
    },
    select: { date: true, amountCents: true },
    orderBy: [{ date: "desc" }, { id: "asc" }],
  });
}

export async function loadAutoInvest(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
) {
  const db = scopedFor(userId, client);
  const [advice, answers, plan, runs, accounts, paycheck] = await Promise.all([
    adviceMode(userId, { client }),
    profileOf(userId, { client }),
    db.autoInvestPlans.findFirst({
      select: { mode: true, amountCents: true, accountId: true, status: true, lastPaydayOn: true },
    }),
    db.autoInvestRuns.findMany({
      select: {
        id: true,
        paydayOn: true,
        status: true,
        amountCents: true,
        safeCents: true,
        reason: true,
      },
      orderBy: [{ paydayOn: "desc" }, { id: "asc" }],
      take: 12,
    }),
    payableAccounts(userId, client),
    db.transactions.findFirst({
      where: { pfcPrimary: "INCOME", amountCents: { lte: -MIN_PAYCHECK_CENTS } },
      select: { amountCents: true },
      orderBy: [{ date: "desc" }, { id: "asc" }],
    }),
  ]);
  const profile = profileSummary(answers, iso(now));
  return {
    advice,
    profileComplete: profile.complete,
    plan,
    runs: runs.map((r) => ({ ...r, paydayOn: iso(r.paydayOn) })),
    accounts,
    // What Jane suggests starting with, from the last paycheck.
    suggestion:
      paycheck && accounts.length > 0
        ? { amountCents: suggestedAmount(-paycheck.amountCents), accountId: accounts[0].id }
        : null,
  };
}

async function audit(userId: string, what: string) {
  await logAudit(
    { type: "user", id: userId },
    "auto_invest_set",
    { type: "user", id: userId },
    { what },
  );
  await track(userId, "auto_invest_set", { what });
}

// Set up (or change) the plan, then run it at once for a paycheck from the last few days.
export async function startAutoInvest(
  userId: string,
  input: { mode: AutoInvestMode; amountCents: number | null; accountId: string },
  { client = defaultClient, now = new Date() }: Options = {},
) {
  const { advice, profileComplete, accounts } = await loadAutoInvest(userId, { client, now });
  if (!advice)
    throw new AutoInvestError("Automatic investing is only in demo advice mode for now.");
  if (!profileComplete) throw new AutoInvestError("Answer the four profile questions first.");
  if (!accounts.some((a) => a.id === input.accountId)) {
    throw new AutoInvestError("Pick one of your investment accounts.");
  }
  if (input.mode === "fixed" && !(input.amountCents && input.amountCents > 0)) {
    throw new AutoInvestError("Enter an amount.");
  }
  const data = {
    mode: input.mode,
    amountCents: input.mode === "fixed" ? input.amountCents : null,
    accountId: input.accountId,
    status: "active",
  };
  await scopedFor(userId, client).autoInvestPlans.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  });
  await audit(userId, `start_${input.mode}`);
  return runAutoInvest(userId, { client, now });
}

export async function setAutoInvestStatus(
  userId: string,
  status: "active" | "paused",
  { client = defaultClient }: Options = {},
) {
  const { count } = await scopedFor(userId, client).autoInvestPlans.updateMany({
    where: {},
    data: { status },
  });
  if (count === 0) throw new AutoInvestError("Automatic investing isn't set up.");
  await audit(userId, status === "paused" ? "pause" : "resume");
}

export type AutoInvestRunResult = {
  paydayOn: string;
  status: "invested" | "paused";
  amountCents: number;
  reason: string | null;
};

// One person's next paycheck, if it hasn't been dealt with. Null when there's nothing to do.
export async function runAutoInvest(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<AutoInvestRunResult | null> {
  const db = scopedFor(userId, client);
  const plan = await db.autoInvestPlans.findFirst({
    select: {
      id: true,
      mode: true,
      amountCents: true,
      accountId: true,
      status: true,
      lastPaydayOn: true,
    },
  });
  if (!plan || plan.status !== "active") return null;
  const [advice, answers, paycheck] = await Promise.all([
    adviceMode(userId, { client }),
    profileOf(userId, { client }),
    latestPaycheck(userId, client, now),
  ]);
  const profile = profileSummary(answers, iso(now));
  if (!advice || !profile.complete || !paycheck) return null;
  if (plan.lastPaydayOn && paycheck.date <= plan.lastPaydayOn) return null;

  const safe = (await homeSummary(userId, { client, now }))?.safeToSpend?.safeCents ?? null;
  const decision = decideContribution({
    mode: plan.mode === "leftover" ? "leftover" : "fixed",
    amountCents: plan.amountCents,
    safeCents: safe,
  });
  let batchId: string | null = null;
  if (decision.status === "invested") {
    batchId = randomUUID();
    const confirmations = await brokeragePartner().placeOrders(
      userId,
      {
        batchId,
        reason: "auto_invest",
        orders: [
          {
            accountId: plan.accountId,
            ticker: "CASH",
            securityName: "Deposit from checking",
            side: "deposit",
            amountCents: decision.amountCents,
          },
          ...contributionBuys(decision.amountCents, profile.riskLevel).map((b) => ({
            accountId: plan.accountId,
            ticker: b.ticker,
            securityName: FUND_NAMES[b.ticker] ?? b.ticker,
            side: "buy" as const,
            amountCents: b.amountCents,
          })),
        ],
      },
      { client, now },
    );
    await logAudit(
      { type: "user", id: userId },
      "brokerage_orders_placed",
      { type: "brokerage_batch", id: batchId },
      {
        reason: "auto_invest",
        orders: confirmations.length,
        simulated: brokeragePartner().simulated,
      },
    );
  }
  await db.autoInvestRuns.create({
    data: {
      userId,
      paydayOn: paycheck.date,
      status: decision.status,
      amountCents: decision.status === "invested" ? decision.amountCents : 0,
      safeCents: safe,
      batchId,
      reason: decision.status === "paused" ? decision.reason : null,
    },
  });
  await db.autoInvestPlans.updateMany({
    where: { id: plan.id },
    data: { lastPaydayOn: paycheck.date },
  });
  await track(userId, "auto_invest_ran", { status: decision.status });
  if (batchId) {
    const account = await db.accounts.findFirst({
      where: { id: plan.accountId },
      select: { itemId: true },
    });
    if (account?.itemId) await syncDemoInvestments(account.itemId, { client, now });
  }
  return {
    paydayOn: iso(paycheck.date),
    status: decision.status,
    amountCents: decision.status === "invested" ? decision.amountCents : 0,
    reason: decision.status === "paused" ? decision.reason : null,
  };
}

// The daily job: every active plan. A failure for one person never stops the rest.
export async function runAutoInvestForAll({
  client = defaultClient,
  now = new Date(),
}: Options = {}) {
  // A system job across all users: it reads owners only; each run is scoped to its person.
  const plans = await client.autoInvestPlan.findMany({
    where: { status: "active", user: { deletedAt: null } },
    select: { userId: true },
  });
  let invested = 0;
  let paused = 0;
  let failed = 0;
  for (const { userId } of plans) {
    try {
      const run = await runAutoInvest(userId, { client, now });
      if (run?.status === "invested") invested += 1;
      if (run?.status === "paused") paused += 1;
    } catch (error) {
      failed += 1;
      console.error("Automatic investing failed", { userId, error: String(error) });
    }
  }
  return { invested, paused, failed };
}
