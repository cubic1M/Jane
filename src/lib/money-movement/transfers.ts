import { TRANSFER_DELAY_DAYS } from "@/config/money-movement";
import type { PrismaClient } from "@/generated/prisma/client";
import type { Sector } from "@/config/autopilot-sectors";
import { addDays } from "@/detection/units";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { moneyPartnerFor, type MoneyMovementPartner } from "./partner";

// Transfers and payments through the money-movement partner (spec steps 144–145). Every one
// is kept and shown on /transfers, and can be undone while it's pending (before its day).
// Audited. Goals tracked by hand count a transfer once it has gone through.

type Options = { client?: PrismaClient; now?: Date; partner?: MoneyMovementPartner | null };

export type NewTransfer = {
  fromAccountId: string;
  toAccountId: string | null;
  toName: string;
  amountCents: number;
  // cash: spec step 162, cash moved to where it earns more (between own accounts).
  purpose: "goal" | "debt" | "bill" | "cash";
  sector: Sector;
  goalId?: string | null;
  planKey?: string | null;
  runOn?: string;
};

export class TransferError extends Error {}

const today = (now: Date) => now.toISOString().slice(0, 10);

export async function scheduleTransfer(
  userId: string,
  transfer: NewTransfer,
  by: "autopilot" | "person",
  { client = defaultClient, now = new Date(), partner }: Options = {},
): Promise<{ id: string; runOn: string }> {
  const movement = partner === undefined ? await moneyPartnerFor(userId, { client }) : partner;
  if (!movement) {
    throw new TransferError(
      "Moving money needs a money-movement partner, and none is connected yet.",
    );
  }
  if (!Number.isInteger(transfer.amountCents) || transfer.amountCents <= 0) {
    throw new TransferError("That amount doesn't look right.");
  }
  const db = scopedFor(userId, client);
  const accounts = await db.accounts.findMany({
    where: { id: { in: [transfer.fromAccountId, transfer.toAccountId ?? ""] } },
    select: { id: true },
  });
  const own = new Set(accounts.map((a) => a.id));
  if (
    !own.has(transfer.fromAccountId) ||
    (transfer.toAccountId && !own.has(transfer.toAccountId))
  ) {
    throw new TransferError("Transfers only go between your own accounts.");
  }
  const runOn = transfer.runOn ?? addDays(today(now), TRANSFER_DELAY_DAYS);
  const { partnerRef } = await movement.schedule({
    fromAccountId: transfer.fromAccountId,
    toAccountId: transfer.toAccountId,
    toName: transfer.toName,
    amountCents: transfer.amountCents,
    runOn,
    memo: transfer.planKey ?? transfer.purpose,
  });
  const row = await db.moneyTransfers.create({
    data: {
      userId,
      fromAccountId: transfer.fromAccountId,
      toAccountId: transfer.toAccountId,
      toName: transfer.toName,
      amountCents: transfer.amountCents,
      purpose: transfer.purpose,
      sector: transfer.sector,
      goalId: transfer.goalId ?? null,
      runOn: new Date(`${runOn}T00:00:00Z`),
      partner: movement.name,
      partnerRef,
      by,
      planKey: transfer.planKey ?? null,
      createdAt: now,
    },
    select: { id: true },
  });
  await logAudit(
    { type: "user", id: userId },
    "money_transfer_scheduled",
    { type: "money_transfer", id: row.id },
    {
      by,
      purpose: transfer.purpose,
      amount_cents: transfer.amountCents,
      simulated: movement.simulated,
    },
  );
  await track(userId, "money_transfer_scheduled", { by, purpose: transfer.purpose });
  return { id: row.id, runOn };
}

// Undo, while it's still pending.
export async function cancelTransfer(
  userId: string,
  transferId: string,
  { client = defaultClient, now = new Date(), partner }: Options = {},
): Promise<void> {
  const db = scopedFor(userId, client);
  const row = await db.moneyTransfers.findFirst({
    where: { id: transferId, status: "pending" },
    select: { id: true, partnerRef: true, runOn: true },
  });
  if (!row || today(row.runOn) < today(now)) {
    throw new TransferError("That transfer has already gone through or been undone.");
  }
  const movement = partner === undefined ? await moneyPartnerFor(userId, { client }) : partner;
  if (movement && row.partnerRef) await movement.cancel(row.partnerRef);
  const { count } = await db.moneyTransfers.updateMany({
    where: { id: transferId, status: "pending" },
    data: { status: "cancelled", cancelledAt: now },
  });
  if (count === 0)
    throw new TransferError("That transfer has already gone through or been undone.");
  await logAudit(
    { type: "user", id: userId },
    "money_transfer_cancelled",
    { type: "money_transfer", id: transferId },
    {},
  );
  await track(userId, "money_transfer_cancelled", {});
}

// Pending transfers whose day has come: through the partner, they've gone through. A goal
// tracked by hand counts what went to it.
export async function settleTransfers(
  userId: string,
  { client = defaultClient, now = new Date(), partner }: Options = {},
): Promise<number> {
  const movement = partner === undefined ? await moneyPartnerFor(userId, { client }) : partner;
  if (!movement) return 0;
  const db = scopedFor(userId, client);
  const pending = await db.moneyTransfers.findMany({
    where: { status: "pending", runOn: { lte: new Date(`${today(now)}T00:00:00Z`) } },
    select: { id: true, runOn: true, goalId: true, amountCents: true },
  });
  let settled = 0;
  for (const t of pending) {
    if (!(await movement.settled({ runOn: today(t.runOn) }, today(now)))) continue;
    const { count } = await db.moneyTransfers.updateMany({
      where: { id: t.id, status: "pending" },
      data: { status: "completed", completedAt: now },
    });
    if (count === 0) continue;
    settled += 1;
    if (t.goalId) {
      const goal = await db.savingsGoals.findFirst({
        where: { id: t.goalId, accountId: null },
        select: { manualSavedCents: true },
      });
      if (goal) {
        await db.savingsGoals.updateMany({
          where: { id: t.goalId },
          data: { manualSavedCents: (goal.manualSavedCents ?? 0) + t.amountCents },
        });
      }
    }
  }
  return settled;
}

export type TransferView = {
  id: string;
  toName: string;
  amountCents: number;
  purpose: string;
  status: string;
  runOn: string;
  by: string;
  partner: string;
  undoable: boolean;
};

export async function listTransfers(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<TransferView[]> {
  const rows = await scopedFor(userId, client).moneyTransfers.findMany({
    orderBy: [{ runOn: "desc" }, { createdAt: "desc" }],
    take: 100,
    select: {
      id: true,
      toName: true,
      amountCents: true,
      purpose: true,
      status: true,
      runOn: true,
      by: true,
      partner: true,
    },
  });
  return rows.map((r) => ({
    ...r,
    runOn: today(r.runOn),
    undoable: r.status === "pending" && today(r.runOn) >= today(now),
  }));
}
