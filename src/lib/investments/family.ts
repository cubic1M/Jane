import { randomBytes, randomUUID } from "node:crypto";
import {
  CUSTODIAL_FUND,
  GIFT_ANNUAL_EXCLUSION_CENTS,
  GIFT_MAX_PER_LINK,
  TOKEN_BYTES,
} from "@/config/family";
import { FUND_NAMES } from "@/config/funds";
import type { PrismaClient } from "@/generated/prisma/client";
import { adviceMode } from "@/lib/advice-mode";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { brokeragePartner } from "@/lib/brokerage/partner";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { addDemoExtra } from "@/lib/plaid/demo";
import { syncDemoInvestments } from "@/lib/plaid/sync";
import { childRothRoom, giftOk, percentFunded } from "@/planning/family";

// Investing for the family (spec step 213, demo advice), for its page, Jane's answers and
// her buttons: a custodial account for a child, a Roth IRA for a child with earned income,
// and gifts into the child's college fund through a share link whose public page shows only
// the goal and how far along it is. Contributions go through the simulated brokerage, each a tap.

type Options = { client?: PrismaClient; now?: Date };

export class FamilyError extends Error {}

const iso = (d: Date) => d.toISOString().slice(0, 10);

export type ChildView = {
  id: string;
  name: string;
  age: number;
  earnedCents: number;
  custodial: { accountId: string; name: string; balanceCents: number } | null;
  roth: { accountId: string; name: string; usedCents: number; roomCents: number } | null;
  college: {
    planId: string;
    goalName: string;
    targetCents: number;
    savedCents: number;
    percent: number;
  } | null;
  gift: { token: string; gifts: { giverName: string; amountCents: number }[] } | null;
};

export type FamilyView = { advice: boolean; children: ChildView[]; demo: boolean };

export async function loadFamily(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<FamilyView> {
  const db = scopedFor(userId, client);
  const year = now.getUTCFullYear();
  const [advice, kids, plans, goals, links, accounts, demo] = await Promise.all([
    adviceMode(userId, { client }),
    db.familyChildren.findMany({ orderBy: { createdAt: "asc" } }),
    db.collegePlans.findMany({ select: { id: true, childName: true, goalId: true } }),
    db.savingsGoals.findMany({
      select: { id: true, name: true, targetCents: true, manualSavedCents: true },
    }),
    db.giftLinks.findMany({
      where: { revokedAt: null },
      include: {
        gifts: { select: { giverName: true, amountCents: true }, orderBy: { createdAt: "asc" } },
      },
    }),
    db.accounts.findMany({
      where: { type: "investment", subtype: { in: ["custodial", "child roth"] } },
      select: { id: true, name: true, subtype: true, currentBalanceCents: true },
    }),
    db.plaidItems.findFirst({
      where: { plaidItemId: { startsWith: "demo-" } },
      select: { id: true },
    }),
  ]);
  const custodialAccount = accounts.find((a) => a.subtype === "custodial");
  const rothAccount = accounts.find((a) => a.subtype === "child roth");
  const rothIn = rothAccount
    ? await db.investmentTransactions.findMany({
        where: {
          accountId: rothAccount.id,
          subtype: "deposit",
          date: { gte: new Date(Date.UTC(year, 0, 1)), lte: now },
        },
        select: { amountCents: true },
      })
    : [];
  const rothUsed = rothIn.reduce((s, t) => s - t.amountCents, 0);
  return {
    advice,
    demo: demo !== null,
    children: kids.map((k, i) => {
      const plan = plans.find((p) => p.childName === k.name);
      const goal = plan?.goalId ? goals.find((g) => g.id === plan.goalId) : undefined;
      const link = plan ? links.find((l) => l.collegePlanId === plan.id) : undefined;
      // Gifts are added to the goal's saved amount when they arrive.
      const saved = goal?.manualSavedCents ?? 0;
      return {
        id: k.id,
        name: k.name,
        age: k.age,
        earnedCents: k.earnedCents,
        // The demo gives the first child the demo accounts.
        custodial:
          i === 0 && custodialAccount
            ? {
                accountId: custodialAccount.id,
                name: custodialAccount.name,
                balanceCents: custodialAccount.currentBalanceCents ?? 0,
              }
            : null,
        roth:
          i === 0 && rothAccount
            ? {
                accountId: rothAccount.id,
                name: rothAccount.name,
                usedCents: rothUsed,
                roomCents: childRothRoom(k.earnedCents, rothUsed),
              }
            : null,
        college:
          plan && goal
            ? {
                planId: plan.id,
                goalName: goal.name,
                targetCents: goal.targetCents,
                savedCents: saved,
                percent: percentFunded(saved, goal.targetCents),
              }
            : null,
        gift: link ? { token: link.token, gifts: link.gifts } : null,
      };
    }),
  };
}

export async function addChild(
  userId: string,
  input: { name: string; age: number; earnedCents: number },
  { client = defaultClient }: Options = {},
) {
  const name = input.name.trim().slice(0, 40);
  if (!name) throw new FamilyError("Enter the child's first name.");
  if (!Number.isInteger(input.age) || input.age < 0 || input.age > 17)
    throw new FamilyError("Enter the child's age, from 0 to 17.");
  if (
    !Number.isInteger(input.earnedCents) ||
    input.earnedCents < 0 ||
    input.earnedCents > 5_000_000
  )
    throw new FamilyError("Check what they earned.");
  const db = scopedFor(userId, client);
  const have = await db.familyChildren.findFirst({ where: { name } });
  if (have) {
    await db.familyChildren.updateMany({
      where: { id: have.id },
      data: { age: input.age, earnedCents: input.earnedCents },
    });
  } else {
    await db.familyChildren.create({ data: { userId, ...input, earnedCents: input.earnedCents } });
  }
}

async function ensureAccount(
  userId: string,
  extra: "custodial" | "child_roth",
  { client = defaultClient, now = new Date() }: Options,
) {
  const itemId = await addDemoExtra(userId, extra, { client });
  if (!itemId) throw new FamilyError("A demo child account needs the demo bank.");
  await syncDemoInvestments(itemId, { client, now });
}

export async function openChildAccount(
  userId: string,
  kind: "custodial" | "child_roth",
  options: Options = {},
) {
  if (!(await adviceMode(userId, { client: options.client })))
    throw new FamilyError("This is only in demo advice mode for now.");
  await ensureAccount(userId, kind, options);
}

// Tap: put money in the child's account (custodial, or Roth up to what they earned).
export async function contributeForChild(
  userId: string,
  childId: string,
  kind: "custodial" | "child_roth",
  amountCents: number,
  { client = defaultClient, now = new Date() }: Options = {},
) {
  const view = await loadFamily(userId, { client, now });
  if (!view.advice) throw new FamilyError("This is only in demo advice mode for now.");
  const child = view.children.find((c) => c.id === childId);
  if (!child) throw new FamilyError("I can't find that child.");
  const target = kind === "custodial" ? child.custodial : child.roth;
  if (!target) throw new FamilyError("That account isn't open yet.");
  if (!Number.isInteger(amountCents) || amountCents <= 0)
    throw new FamilyError("That amount doesn't look right.");
  if (kind === "child_roth" && amountCents > (child.roth?.roomCents ?? 0))
    throw new FamilyError(
      child.earnedCents <= 0
        ? `${child.name} needs earned income to have a Roth IRA.`
        : "That's more than they can put in a Roth IRA this year.",
    );
  const partner = brokeragePartner();
  const batchId = randomUUID();
  await partner.placeOrders(
    userId,
    {
      batchId,
      reason: kind === "custodial" ? "custodial_contribution" : "child_roth_contribution",
      orders: [
        {
          accountId: target.accountId,
          ticker: "CASH",
          securityName: "Contribution from checking",
          side: "deposit",
          amountCents,
        },
        {
          accountId: target.accountId,
          ticker: CUSTODIAL_FUND,
          securityName: FUND_NAMES[CUSTODIAL_FUND] ?? CUSTODIAL_FUND,
          side: "buy",
          amountCents,
        },
      ],
    },
    { client, now },
  );
  await logAudit(
    { type: "user", id: userId },
    "brokerage_orders_placed",
    { type: "brokerage_batch", id: batchId },
    { reason: kind, orders: 2, simulated: partner.simulated },
  );
  const account = await scopedFor(userId, client).accounts.findFirst({
    where: { id: target.accountId },
    select: { itemId: true },
  });
  if (account?.itemId) await syncDemoInvestments(account.itemId, { client, now });
  await track(userId, "family_contribution", { kind });
  return { child: child.name, accountName: target.name };
}

// A link relatives can use to give to a child's college fund.
export async function createGiftLink(
  userId: string,
  collegePlanId: string,
  { client = defaultClient }: Options = {},
) {
  const db = scopedFor(userId, client);
  const plan = await db.collegePlans.findFirst({
    where: { id: collegePlanId },
    select: { id: true, goalId: true },
  });
  if (!plan?.goalId) throw new FamilyError("Start saving for college first.");
  await db.giftLinks.updateMany({
    where: { collegePlanId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  const row = await db.giftLinks.create({
    data: { userId, collegePlanId, token },
    select: { id: true },
  });
  await logAudit(
    { type: "user", id: userId },
    "gift_link_created",
    { type: "gift_link", id: row.id },
    {},
  );
  return token;
}

export async function revokeGiftLinks(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
) {
  const { count } = await scopedFor(userId, client).giftLinks.updateMany({
    where: { revokedAt: null },
    data: { revokedAt: now },
  });
  if (count > 0)
    await logAudit(
      { type: "user", id: userId },
      "gift_link_revoked",
      { type: "user", id: userId },
      { count },
    );
  return count;
}

export type PublicGift = {
  goalName: string;
  childName: string;
  targetCents: number;
  percent: number;
};

// For the public page: a link's goal and how far along it is, and nothing else. A lookup by
// the token across everyone, by design: the link is the permission. The percent counts what
// the goal has, gifts included; the page never shows an amount saved, an account or a name
// of the person who owns it.
export async function giftPage(
  token: string,
  { client = defaultClient }: Options = {},
): Promise<PublicGift | null> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;
  const link = await client.giftLink.findUnique({ where: { token } });
  if (!link || link.revokedAt) return null;
  const plan = await client.collegePlan.findUnique({ where: { id: link.collegePlanId } });
  const goal = plan?.goalId
    ? await client.savingsGoal.findUnique({ where: { id: plan.goalId } })
    : null;
  if (!plan || !goal) return null;
  return {
    goalName: goal.name,
    childName: plan.childName,
    targetCents: goal.targetCents,
    percent: percentFunded(goal.manualSavedCents ?? 0, goal.targetCents),
  };
}

// A relative's gift (a stand-in: no real money moves): counted toward the goal.
export async function giveGift(
  token: string,
  input: { giverName: string; amountCents: number },
  { client = defaultClient }: Options = {},
) {
  const page = await giftPage(token, { client });
  if (!page) throw new FamilyError("This link isn't taking gifts anymore.");
  const giver = input.giverName.trim().slice(0, 40);
  if (!giver) throw new FamilyError("Enter your name.");
  if (!giftOk(input.amountCents))
    throw new FamilyError(
      `A gift can be $5 up to $${GIFT_ANNUAL_EXCLUSION_CENTS / 100} (the most you can give in a year without a gift tax return).`,
    );
  const link = await client.giftLink.findUniqueOrThrow({
    where: { token },
    include: { _count: { select: { gifts: true } } },
  });
  if (link._count.gifts >= GIFT_MAX_PER_LINK)
    throw new FamilyError("This link has taken all the gifts it can.");
  const plan = await client.collegePlan.findUniqueOrThrow({ where: { id: link.collegePlanId } });
  await client.$transaction([
    client.gift.create({
      data: { giftLinkId: link.id, giverName: giver, amountCents: input.amountCents },
    }),
    client.savingsGoal.update({
      where: { id: plan.goalId! },
      data: { manualSavedCents: { increment: input.amountCents } },
    }),
  ]);
  await logAudit(
    { type: "system", id: null },
    "gift_received",
    { type: "user", id: link.userId },
    { amount_cents: input.amountCents },
  );
  return { goalName: page.goalName };
}
