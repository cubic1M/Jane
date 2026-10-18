import { SHARED_CHARGE_DAYS } from "@/config/household";
import type { PrismaClient } from "@/generated/prisma/client";
import { logAudit } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import { scopedFor, sharedReadFor } from "@/lib/db-scoped";

// Shared bills between the two people in a household: a charge on a shared account can
// be split, a running balance says who owes whom (the same from either side), and
// "settle up" records the payment that brings it to zero. Everything belongs to the
// household, so it ends when someone leaves.

type Options = { client?: PrismaClient };

const FULL_BPS = 10_000;
export const HALF_BPS = 5_000;

export class SharedBillError extends Error {}

async function pair(userId: string, client: PrismaClient) {
  const membership = await client.householdMember.findUnique({
    where: { userId },
    select: { householdId: true },
  });
  if (!membership) return null;
  const partner = await client.householdMember.findFirst({
    where: { householdId: membership.householdId, userId: { not: userId } },
    select: { userId: true, user: { select: { email: true } } },
  });
  return partner
    ? {
        householdId: membership.householdId,
        partnerId: partner.userId,
        partnerEmail: partner.user.email,
      }
    : null;
}

// Splits a charge on a shared account (either person's). The account's owner paid; the
// other person owes partnerShareBps of it.
export async function splitCharge(
  userId: string,
  transactionId: string,
  partnerShareBps: number = HALF_BPS,
  { client = defaultClient }: Options = {},
): Promise<void> {
  const household = await pair(userId, client);
  if (!household) throw new SharedBillError("Splitting needs a partner in your household.");
  if (!Number.isInteger(partnerShareBps) || partnerShareBps < 1 || partnerShareBps > FULL_BPS) {
    throw new SharedBillError("The split must be between 1% and 100%.");
  }
  const charge = await client.transaction.findUnique({
    where: { id: transactionId },
    select: {
      id: true,
      userId: true,
      amountCents: true,
      account: { select: { sharedWithHousehold: true } },
    },
  });
  const members = [userId, household.partnerId];
  if (!charge || !members.includes(charge.userId) || !charge.account.sharedWithHousehold) {
    throw new SharedBillError("Only charges on shared accounts can be split.");
  }
  if (charge.amountCents <= 0) throw new SharedBillError("Only money going out can be split.");
  await client.sharedCharge.upsert({
    where: { transactionId: charge.id },
    create: {
      householdId: household.householdId,
      transactionId: charge.id,
      payerId: charge.userId,
      amountCents: charge.amountCents,
      partnerShareBps,
      userId,
    },
    update: { partnerShareBps, userId },
  });
  await logAudit(
    { type: "user", id: userId },
    "charge_split",
    { type: "transaction", id: charge.id },
    {
      partner_share_bps: partnerShareBps,
    },
  );
}

export async function unsplitCharge(
  userId: string,
  sharedChargeId: string,
  { client = defaultClient }: Options = {},
): Promise<void> {
  const household = await pair(userId, client);
  if (!household) return;
  await client.sharedCharge.deleteMany({
    where: { id: sharedChargeId, householdId: household.householdId },
  });
}

type ChargeRow = { payerId: string; amountCents: number; partnerShareBps: number };
type SettlementRow = { fromUserId: string; toUserId: string; amountCents: number };

// Pure: what the partner owes `viewer` (negative when the viewer owes the partner).
export function balanceFor(
  viewerId: string,
  charges: ChargeRow[],
  settlements: SettlementRow[],
): number {
  let owed = 0;
  for (const c of charges) {
    const share = Math.round((c.amountCents * c.partnerShareBps) / FULL_BPS);
    owed += c.payerId === viewerId ? share : -share;
  }
  for (const s of settlements) {
    if (s.toUserId === viewerId) owed -= s.amountCents;
    if (s.fromUserId === viewerId) owed += s.amountCents;
  }
  return owed;
}

export async function sharedBills(userId: string, { client = defaultClient }: Options = {}) {
  const household = await pair(userId, client);
  if (!household) return null;
  const [charges, settlements] = await Promise.all([
    client.sharedCharge.findMany({
      where: { householdId: household.householdId },
      select: {
        id: true,
        transactionId: true,
        payerId: true,
        amountCents: true,
        partnerShareBps: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    }),
    client.settlement.findMany({
      where: { householdId: household.householdId },
      select: { fromUserId: true, toUserId: true, amountCents: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  return {
    partnerEmail: household.partnerEmail,
    partnerId: household.partnerId,
    owedToMeCents: balanceFor(userId, charges, settlements),
    charges,
    settlements,
  };
}

// Records that the balance was paid, bringing it to zero.
export async function settleUp(userId: string, { client = defaultClient }: Options = {}) {
  const bills = await sharedBills(userId, { client });
  if (!bills || bills.owedToMeCents === 0) return;
  const household = await pair(userId, client);
  if (!household) return;
  const partnerPaid = bills.owedToMeCents > 0;
  await client.settlement.create({
    data: {
      householdId: household.householdId,
      fromUserId: partnerPaid ? household.partnerId : userId,
      toUserId: partnerPaid ? userId : household.partnerId,
      amountCents: Math.abs(bills.owedToMeCents),
      userId,
    },
  });
  await logAudit(
    { type: "user", id: userId },
    "household_settled",
    {
      type: "household",
      id: household.householdId,
    },
    { amount_cents: Math.abs(bills.owedToMeCents) },
  );
}

export type ShareableCharge = {
  id: string;
  date: string;
  merchant: string | null;
  description: string;
  amountCents: number;
  mine: boolean;
};

// Recent money out on either person's shared accounts, newest first: what can be split.
export async function shareableCharges(
  userId: string,
  { client = defaultClient, now = new Date() }: Options & { now?: Date } = {},
): Promise<ShareableCharge[]> {
  const since = new Date(now.getTime() - SHARED_CHARGE_DAYS * 24 * 60 * 60 * 1000);
  const [mine, shared] = await Promise.all([
    scopedFor(userId, client).transactions.findMany({
      where: {
        date: { gte: since },
        amountCents: { gt: 0 },
        account: { sharedWithHousehold: true },
      },
      select: { id: true, date: true, merchantName: true, description: true, amountCents: true },
    }),
    sharedReadFor(userId, client),
  ]);
  const theirs = await shared.transactions({ date: { gte: since }, amountCents: { gt: 0 } });
  return [...mine.map((t) => ({ ...t, mine: true })), ...theirs.map((t) => ({ ...t, mine: false }))]
    .map((t) => ({
      id: t.id,
      date: t.date.toISOString().slice(0, 10),
      merchant: t.merchantName,
      description: t.description,
      amountCents: t.amountCents,
      mine: t.mine,
    }))
    .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
}
