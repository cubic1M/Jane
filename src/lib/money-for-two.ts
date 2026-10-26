import {
  BIG_MOVE_MAX_CENTS,
  BIG_MOVE_MIN_CENTS,
  DEFAULT_BIG_MOVE_CENTS,
  SPLIT_INCOME_DAYS,
  SPLIT_RULES,
  WAGE_CATEGORIES,
  type SplitRule,
} from "@/config/money-for-two";
import type { PrismaClient } from "@/generated/prisma/client";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { moneyPartnerFor } from "@/lib/money-movement/partner";
import { sharedBills } from "@/lib/shared-bills";
import { partnerShareBps } from "@/planning/money-for-two";
import { DAY_MS, isoDay as today } from "@/lib/dates";

// Money for two (spec step 242): a couple in a household (step 25) runs money together and
// still keeps their own. Shared bills split evenly or by income as they choose; goals can be
// joint; a big move out of a shared account needs both partners' taps; and once a month both
// get a short "money date". Each person's own accounts, goals and moves stay private: the
// partner only ever sees what was shared, and only the split's shares, never the other's
// income. Partner reads here always check the household first.

type Options = { client?: PrismaClient; now?: Date };

export class MoneyForTwoError extends Error {}

async function couple(userId: string, client: PrismaClient) {
  const membership = await client.householdMember.findUnique({
    where: { userId },
    select: {
      household: {
        select: {
          id: true,
          splitRule: true,
          splitSetAt: true,
          bigMoveCents: true,
          members: {
            where: { userId: { not: userId } },
            select: { userId: true, user: { select: { email: true, name: true } } },
          },
        },
      },
    },
  });
  const household = membership?.household;
  const partner = household?.members[0];
  if (!household || !partner) return null;
  return {
    householdId: household.id,
    rule: (SPLIT_RULES as readonly string[]).includes(household.splitRule)
      ? (household.splitRule as SplitRule)
      : "even",
    chosen: household.splitSetAt !== null,
    bigMoveCents: household.bigMoveCents ?? DEFAULT_BIG_MOVE_CENTS,
    partnerId: partner.userId,
    partnerName: partner.user.name ?? partner.user.email,
  };
}

// What someone was paid by employers lately: only ever summed, to work out the shares.
async function recentPay(userId: string, client: PrismaClient, now: Date): Promise<number> {
  const since = new Date(now.getTime() - SPLIT_INCOME_DAYS * DAY_MS);
  const sum = await client.transaction.aggregate({
    where: {
      userId,
      date: { gte: since, lte: now },
      amountCents: { lt: 0 },
      pfcDetailed: { in: [...WAGE_CATEGORIES] },
    },
    _sum: { amountCents: true },
  });
  return -(sum._sum.amountCents ?? 0);
}

// The partner's share of a new shared bill, under the household's rule.
export async function splitShareFor(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<number | null> {
  const pair = await couple(userId, client);
  if (!pair) return null;
  if (pair.rule === "even") return partnerShareBps("even", 0, 0);
  const [mine, theirs] = await Promise.all([
    recentPay(userId, client, now),
    recentPay(pair.partnerId, client, now),
  ]);
  return partnerShareBps("income", mine, theirs);
}

export async function setSplitRule(
  userId: string,
  rule: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<SplitRule> {
  if (!(SPLIT_RULES as readonly string[]).includes(rule)) {
    throw new MoneyForTwoError("Choose half each or by income.");
  }
  const pair = await couple(userId, client);
  if (!pair) throw new MoneyForTwoError("Splitting bills needs a partner in your household.");
  await client.household.update({
    where: { id: pair.householdId },
    data: { splitRule: rule, splitSetAt: now },
  });
  await logAudit(
    { type: "user", id: userId },
    "household_split_set",
    { type: "household", id: pair.householdId },
    { rule },
  );
  await track(userId, "household_split_set", { rule });
  return rule as SplitRule;
}

export async function setBigMoveLimit(
  userId: string,
  cents: number,
  { client = defaultClient }: Options = {},
): Promise<void> {
  if (!Number.isInteger(cents) || cents < BIG_MOVE_MIN_CENTS || cents > BIG_MOVE_MAX_CENTS) {
    throw new MoneyForTwoError("Choose an amount between $100 and $100,000.");
  }
  const pair = await couple(userId, client);
  if (!pair) throw new MoneyForTwoError("This needs a partner in your household.");
  await client.household.update({ where: { id: pair.householdId }, data: { bigMoveCents: cents } });
  await logAudit(
    { type: "user", id: userId },
    "household_big_move_set",
    { type: "household", id: pair.householdId },
    { cents },
  );
}

// A joint goal: the partner sees it (and its progress); off again makes it private.
export async function setGoalSharing(
  userId: string,
  goalId: string,
  shared: boolean,
  { client = defaultClient }: Options = {},
): Promise<boolean> {
  const { count } = await scopedFor(userId, client).savingsGoals.updateMany({
    where: { id: goalId },
    data: { sharedWithHousehold: shared },
  });
  if (count > 0) {
    await logAudit(
      { type: "user", id: userId },
      "goal_sharing_changed",
      { type: "savings_goal", id: goalId },
      { shared },
    );
  }
  return count > 0;
}

// Whether a move out of `fromAccountId` needs the partner's tap too: a shared account, and the
// household's big-move amount or more. Null when it doesn't.
export async function bigMoveCheck(
  userId: string,
  fromAccountId: string,
  amountCents: number,
  client: PrismaClient,
): Promise<{ partnerId: string; limitCents: number } | null> {
  const account = await scopedFor(userId, client).accounts.findFirst({
    where: { id: fromAccountId },
    select: { sharedWithHousehold: true },
  });
  if (!account?.sharedWithHousehold) return null;
  const pair = await couple(userId, client);
  if (!pair || amountCents < pair.bigMoveCents) return null;
  return { partnerId: pair.partnerId, limitCents: pair.bigMoveCents };
}

// The partner's tap on a big move that waits for it: it goes to the money-movement partner
// now, as if it had just been scheduled. Only the other partner in the same household can.
export async function approveBigMove(
  userId: string,
  transferId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<{ amountCents: number; runOn: string }> {
  const pair = await couple(userId, client);
  if (!pair) throw new MoneyForTwoError("Only your household partner's moves wait for you.");
  const move = await client.moneyTransfer.findFirst({
    where: { id: transferId, userId: pair.partnerId, status: "awaiting_partner" },
    select: {
      id: true,
      fromAccountId: true,
      toAccountId: true,
      toName: true,
      amountCents: true,
      runOn: true,
      planKey: true,
      purpose: true,
    },
  });
  if (!move) throw new MoneyForTwoError("That move isn't waiting for you any more.");
  const movement = await moneyPartnerFor(pair.partnerId, { client });
  if (!movement) throw new MoneyForTwoError("No money-movement partner is connected.");
  const runOn = today(move.runOn) < today(now) ? today(now) : today(move.runOn);
  const { partnerRef } = await movement.schedule({
    fromAccountId: move.fromAccountId,
    toAccountId: move.toAccountId,
    toName: move.toName,
    amountCents: move.amountCents,
    runOn,
    memo: move.planKey ?? move.purpose,
  });
  const { count } = await client.moneyTransfer.updateMany({
    where: { id: move.id, status: "awaiting_partner" },
    data: {
      status: "pending",
      partnerRef,
      partner: movement.name,
      approvedById: userId,
      runOn: new Date(`${runOn}T00:00:00Z`),
    },
  });
  if (count === 0) throw new MoneyForTwoError("That move isn't waiting for you any more.");
  await logAudit(
    { type: "user", id: userId },
    "big_move_approved",
    { type: "money_transfer", id: move.id },
    { amount_cents: move.amountCents },
  );
  return { amountCents: move.amountCents, runOn };
}

export async function declineBigMove(
  userId: string,
  transferId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<void> {
  const pair = await couple(userId, client);
  if (!pair) throw new MoneyForTwoError("Only your household partner's moves wait for you.");
  const { count } = await client.moneyTransfer.updateMany({
    where: { id: transferId, userId: pair.partnerId, status: "awaiting_partner" },
    data: { status: "cancelled", cancelledAt: now },
  });
  if (count === 0) throw new MoneyForTwoError("That move isn't waiting for you any more.");
  await logAudit(
    { type: "user", id: userId },
    "big_move_declined",
    { type: "money_transfer", id: transferId },
    {},
  );
}

export type BigMove = {
  id: string;
  amountCents: number;
  toName: string;
  runOn: string;
  // Mine: waiting for the partner. Not mine: waiting for my tap.
  mine: boolean;
};

export type JointGoal = {
  id: string;
  name: string;
  targetCents: number;
  savedCents: number;
  targetDate: string;
  mine: boolean;
};

export type MoneyForTwoView = {
  partnerName: string;
  rule: SplitRule;
  // Whether one of them chose the rule (the default is half each).
  chosen: boolean;
  // My share and the partner's of a new shared bill, in basis points; and what the shares
  // would be by income (never either income itself).
  myShareBps: number;
  incomeMyShareBps: number;
  bigMoveCents: number;
  owedToMeCents: number;
  sharedSpentCents: number;
  jointGoals: JointGoal[];
  bigMoves: BigMove[];
  month: string;
};

const savedOf = (
  g: { accountId: string | null; manualSavedCents: number | null },
  balances: Map<string, number | null>,
) =>
  g.accountId ? (balances.get(g.accountId) ?? g.manualSavedCents ?? 0) : (g.manualSavedCents ?? 0);

export async function loadMoneyForTwo(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<MoneyForTwoView | null> {
  const pair = await couple(userId, client);
  if (!pair) return null;
  const monthStart = new Date(`${now.toISOString().slice(0, 7)}-01T00:00:00Z`);
  const ids = [userId, pair.partnerId];
  const [mine, theirs, bills, goals, moves, spent] = await Promise.all([
    recentPay(userId, client, now),
    recentPay(pair.partnerId, client, now),
    sharedBills(userId, { client }),
    // Joint goals only: a goal neither shared stays with its owner.
    client.savingsGoal.findMany({
      where: { userId: { in: ids }, sharedWithHousehold: true },
      select: {
        id: true,
        userId: true,
        name: true,
        targetCents: true,
        targetDate: true,
        accountId: true,
        manualSavedCents: true,
      },
      orderBy: [{ targetDate: "asc" }, { id: "asc" }],
    }),
    client.moneyTransfer.findMany({
      where: { userId: { in: ids }, status: "awaiting_partner" },
      select: { id: true, userId: true, amountCents: true, toName: true, runOn: true },
      orderBy: { createdAt: "asc" },
    }),
    // Spent together this month: money out of the accounts either of them shared.
    client.transaction.aggregate({
      where: {
        userId: { in: ids },
        account: { sharedWithHousehold: true },
        date: { gte: monthStart, lte: now },
        amountCents: { gt: 0 },
        NOT: { pfcPrimary: { in: ["TRANSFER_OUT", "TRANSFER_IN"] } },
      },
      _sum: { amountCents: true },
    }),
  ]);
  const goalAccounts = goals.flatMap((g) => (g.accountId ? [g.accountId] : []));
  const balances = new Map(
    (goalAccounts.length
      ? await client.account.findMany({
          where: { id: { in: goalAccounts }, userId: { in: ids } },
          select: { id: true, currentBalanceCents: true },
        })
      : []
    ).map((a) => [a.id, a.currentBalanceCents]),
  );
  const ruleShare = pair.rule === "even" ? 5_000 : partnerShareBps("income", mine, theirs);
  return {
    partnerName: pair.partnerName,
    rule: pair.rule,
    chosen: pair.chosen,
    myShareBps: 10_000 - ruleShare,
    incomeMyShareBps: 10_000 - partnerShareBps("income", mine, theirs),
    bigMoveCents: pair.bigMoveCents,
    owedToMeCents: bills?.owedToMeCents ?? 0,
    sharedSpentCents: spent._sum.amountCents ?? 0,
    jointGoals: goals.map((g) => ({
      id: g.id,
      name: g.name,
      targetCents: g.targetCents,
      savedCents: savedOf(g, balances),
      targetDate: today(g.targetDate),
      mine: g.userId === userId,
    })),
    bigMoves: moves.map((m) => ({
      id: m.id,
      amountCents: m.amountCents,
      toName: m.toName,
      runOn: today(m.runOn),
      mine: m.userId === userId,
    })),
    month: now.toISOString().slice(0, 7),
  };
}
