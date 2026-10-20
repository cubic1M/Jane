import { randomUUID } from "node:crypto";
import { OLD_PLAN_LOCATOR } from "@/config/old-accounts";
import { FUND_FACTS, FUND_NAMES } from "@/config/funds";
import type { PrismaClient } from "@/generated/prisma/client";
import { demoOptionsAllowed } from "@/lib/compare";
import { adviceMode } from "@/lib/advice-mode";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { brokeragePartner } from "@/lib/brokerage/partner";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { addDemoExtra, hasDemoBank } from "@/lib/plaid/demo";
import { syncDemoInvestments } from "@/lib/plaid/sync";
import { contributionBuys } from "@/planning/auto-invest";
import { profileSummary } from "@/planning/investor-profile";
import {
  arrivesOn,
  feeComparison,
  isComplete,
  newSteps,
  stepsOn,
  type Step,
} from "@/planning/rollover";
import { profileOf } from "./profile";

// Old accounts brought home (spec step 211), for its page, Jane's questions and her
// buttons. Past employers come from payroll history and the person's own answers (a
// stand-in for demo-bank people); each is asked about once. A found plan is read-only with
// its fees compared; a rollover is direct (never a check to the person), tracked step by
// step, and never counts as a withdrawal or a contribution.

type Options = { client?: PrismaClient; now?: Date };

export class OldAccountsError extends Error {}

const iso = (d: Date) => d.toISOString().slice(0, 10);

// Past employers from payroll history: a stand-in for demo-bank people.
async function payrollHistory(userId: string, client: PrismaClient): Promise<string[]> {
  if (!demoOptionsAllowed() || !(await hasDemoBank(userId, { client }))) return [];
  return ["Globex Industries"];
}

// The plan locator: records for a past employer's plan. The stand-in knows the demo
// employer; a real locator (a plan-search partner) answers for the rest.
export type LocatedPlan = { planName: string; balanceCents: number; expenseRatioBps: number };
async function locate(
  userId: string,
  employer: string,
  client: PrismaClient,
): Promise<LocatedPlan | null> {
  if (!(await hasDemoBank(userId, { client })) || employer !== "Globex Industries") return null;
  return {
    planName: "Globex Industries 401(k) Plan",
    balanceCents: 3_820_000,
    expenseRatioBps: 112,
  };
}

export type OldPlanView = {
  id: string;
  employer: string;
  status: string;
  planName: string | null;
  balanceCents: number | null;
  fees: ReturnType<typeof feeComparison> | null;
  steps: Step[];
  arrivesOn: string | null;
};

export type OldAccountsView = { advice: boolean; plans: OldPlanView[]; demo: boolean };

// The index fund a rollover is invested in; its fee is the "after".
const NEW_FUND = "KTSIX";
const newBps = () => FUND_FACTS[NEW_FUND].expenseRatioBps;

const viewOf = (row: {
  id: string;
  employer: string;
  status: string;
  planName: string | null;
  balanceCents: number | null;
  expenseRatioBps: number | null;
  steps: unknown;
  rollingSince: Date | null;
}): OldPlanView => ({
  id: row.id,
  employer: row.employer,
  status: row.status,
  planName: row.planName,
  balanceCents: row.balanceCents,
  fees:
    row.balanceCents !== null && row.expenseRatioBps !== null
      ? feeComparison({
          balanceCents: row.balanceCents,
          oldBps: row.expenseRatioBps,
          newBps: newBps(),
        })
      : null,
  steps: Array.isArray(row.steps) ? (row.steps as Step[]) : [],
  arrivesOn: row.rollingSince ? arrivesOn(iso(row.rollingSince)) : null,
});

// Makes sure each past employer has a row, asked about once.
export async function syncPastEmployers(userId: string, { client = defaultClient }: Options = {}) {
  const db = scopedFor(userId, client);
  for (const employer of await payrollHistory(userId, client)) {
    const have = await db.oldPlans.count({ where: { employer } });
    if (have === 0) await db.oldPlans.create({ data: { userId, employer, source: "demo" } });
  }
}

export async function addPastEmployer(
  userId: string,
  employer: string,
  { client = defaultClient }: Options = {},
) {
  const name = employer.trim().slice(0, 80);
  if (!name) throw new OldAccountsError("Enter the employer's name.");
  const db = scopedFor(userId, client);
  if ((await db.oldPlans.count({ where: { employer: name } })) > 0)
    throw new OldAccountsError("You've already told me about that employer.");
  await db.oldPlans.create({ data: { userId, employer: name, source: "you" } });
}

export async function loadOldAccounts(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<OldAccountsView> {
  await syncPastEmployers(userId, { client });
  await settleRollovers(userId, { client, now });
  const db = scopedFor(userId, client);
  const [advice, rows, demo] = await Promise.all([
    adviceMode(userId, { client }),
    db.oldPlans.findMany({ orderBy: { createdAt: "asc" } }),
    hasDemoBank(userId, { client }),
  ]);
  return { advice, plans: rows.map(viewOf), demo };
}

// "Did you have a 401(k) at X?" Yes asks the locator; No closes it.
export async function answerOldPlan(
  userId: string,
  planId: string,
  had: boolean,
  { client = defaultClient }: Options = {},
) {
  const db = scopedFor(userId, client);
  const row = await db.oldPlans.findFirst({ where: { id: planId, status: "asked" } });
  if (!row) throw new OldAccountsError("That question was already answered.");
  if (!had) {
    await db.oldPlans.updateMany({ where: { id: planId }, data: { status: "no_plan" } });
    return { found: false as const };
  }
  const located = await locate(userId, row.employer, client);
  if (!located) {
    await db.oldPlans.updateMany({ where: { id: planId }, data: { status: "not_found" } });
    return { found: false as const, lookup: true as const };
  }
  await db.oldPlans.updateMany({
    where: { id: planId },
    data: {
      status: "found",
      planName: located.planName,
      balanceCents: located.balanceCents,
      expenseRatioBps: located.expenseRatioBps,
      locator: OLD_PLAN_LOCATOR,
    },
  });
  await logAudit(
    { type: "user", id: userId },
    "old_plan_found",
    { type: "old_plan", id: planId },
    { locator: OLD_PLAN_LOCATOR },
  );
  await track(userId, "old_plan_found", {});
  return { found: true as const, ...located };
}

// Tap: start the direct rollover into a traditional IRA (the demo rollover IRA is linked
// first if there's none). Nothing moves until the stand-in plan sends it, days later.
export async function startRollover(
  userId: string,
  planId: string,
  { client = defaultClient, now = new Date() }: Options = {},
) {
  if (!(await adviceMode(userId, { client })))
    throw new OldAccountsError("Rollovers are only in demo advice mode for now.");
  const db = scopedFor(userId, client);
  const row = await db.oldPlans.findFirst({ where: { id: planId, status: "found" } });
  if (!row || row.balanceCents === null)
    throw new OldAccountsError("That plan isn't ready to roll over.");
  const itemId = await addDemoExtra(userId, "rollover_ira", { client });
  if (!itemId)
    throw new OldAccountsError(
      "A rollover needs an IRA to land in: a demo one needs the demo bank.",
    );
  await syncDemoInvestments(itemId, { client, now });
  const ira = await db.accounts.findFirst({
    where: { subtype: "ira", name: "Demo Rollover IRA" },
    select: { id: true },
  });
  if (!ira) throw new OldAccountsError("The rollover IRA isn't ready yet.");
  await db.oldPlans.updateMany({
    where: { id: planId },
    data: {
      status: "rolling",
      destinationId: ira.id,
      rollingSince: now,
      steps: stepsOn(iso(now), iso(now)),
    },
  });
  await logAudit(
    { type: "user", id: userId },
    "rollover_started",
    { type: "old_plan", id: planId },
    { direct: true },
  );
  await track(userId, "rollover_started", {});
  return { arrivesOn: arrivesOn(iso(now)), balanceCents: row.balanceCents };
}

// The stand-in plan sends the money after ROLLOVER_DAYS: a transfer into the IRA (not a
// contribution), invested in the person's mix. Idempotent; also run by the nightly cron.
export async function settleRollovers(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
) {
  const db = scopedFor(userId, client);
  const rolling = await db.oldPlans.findMany({ where: { status: "rolling" } });
  let done = 0;
  for (const row of rolling) {
    if (!row.rollingSince || !row.destinationId || row.balanceCents === null) continue;
    const steps = stepsOn(iso(row.rollingSince), iso(now));
    if (!isComplete(steps)) {
      await db.oldPlans.updateMany({ where: { id: row.id }, data: { steps } });
      continue;
    }
    // Claim it first so two runs can't both send the money.
    const claimed = await db.oldPlans.updateMany({
      where: { id: row.id, status: "rolling" },
      data: { status: "rolled", steps, rolledAt: now },
    });
    if (claimed.count === 0) continue;
    const answers = await profileOf(userId, { client });
    const profile = profileSummary(answers, iso(now));
    const buys = contributionBuys(row.balanceCents, profile.complete ? profile.riskLevel : 3);
    const batchId = randomUUID();
    await brokeragePartner().placeOrders(
      userId,
      {
        batchId,
        reason: "rollover",
        orders: [
          {
            accountId: row.destinationId,
            ticker: "ROLLOVER",
            securityName: `Rollover from ${row.planName ?? row.employer}`,
            side: "deposit",
            amountCents: row.balanceCents,
          },
          ...buys.map((b) => ({
            accountId: row.destinationId!,
            ticker: b.ticker,
            securityName: FUND_NAMES[b.ticker] ?? b.ticker,
            side: "buy" as const,
            amountCents: b.amountCents,
          })),
        ],
      },
      { client, now },
    );
    const account = await db.accounts.findFirst({
      where: { id: row.destinationId },
      select: { itemId: true },
    });
    if (account?.itemId) await syncDemoInvestments(account.itemId, { client, now });
    await logAudit(
      { type: "system", id: null },
      "rollover_completed",
      { type: "old_plan", id: row.id },
      { direct: true },
    );
    done += 1;
  }
  return done;
}

export async function settleAllRollovers({
  client = defaultClient,
  now = new Date(),
}: Options = {}) {
  const people = await client.oldPlan.findMany({
    where: { status: "rolling" },
    select: { userId: true },
    distinct: ["userId"],
    take: 500,
  });
  let done = 0;
  for (const { userId } of people) done += await settleRollovers(userId, { client, now });
  return { people: people.length, done };
}

export const rolloverSteps = newSteps;
