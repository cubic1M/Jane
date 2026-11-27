import { TRANSFER_DELAY_DAYS } from "@/config/money-movement";
import type { PrismaClient } from "@/generated/prisma/client";
import type { Sector } from "@/config/autopilot-sectors";
import { addDays } from "@/detection/units";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { log } from "@/lib/log";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { bigMoveCheck } from "@/lib/money-for-two";
import { moneyPartnerFor, type MoneyMovementPartner } from "./partner";
import { isoDay as today } from "@/lib/dates";

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

// The transfer is saved (and, past the partner check, scheduled) before its audit row and funnel
// event: if either fails, the caller still needs the id, to show it and to offer Undo. The failure
// is logged by the transfer's id alone, never rethrown (CodeRabbit sweep part 2).
async function recorded(transferId: string, write: () => Promise<void>): Promise<void> {
  try {
    await write();
  } catch (error) {
    log.error("money transfer saved, but its audit or analytics write failed", {
      transferId,
      error: error instanceof Error ? error.name : "unknown",
    });
  }
}

export async function scheduleTransfer(
  userId: string,
  transfer: NewTransfer,
  by: "autopilot" | "person",
  { client = defaultClient, now = new Date(), partner }: Options = {},
): Promise<{ id: string; runOn: string; awaitingPartner?: boolean }> {
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
  // Spec step 242: a big move out of a shared account waits for the other partner's tap, and
  // only goes to the money-movement partner once it comes (src/lib/money-for-two.ts).
  const both = await bigMoveCheck(userId, transfer.fromAccountId, transfer.amountCents, client);
  if (both) {
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
        status: "awaiting_partner",
        runOn: new Date(`${runOn}T00:00:00Z`),
        partner: movement.name,
        partnerRef: null,
        by,
        planKey: transfer.planKey ?? null,
        createdAt: now,
      },
      select: { id: true },
    });
    await recorded(row.id, async () => {
      await logAudit(
        { type: "user", id: userId },
        "money_transfer_awaiting_partner",
        { type: "money_transfer", id: row.id },
        { by, purpose: transfer.purpose, amount_cents: transfer.amountCents },
      );
      await track(userId, "money_transfer_awaiting_partner", { by, purpose: transfer.purpose });
    });
    return { id: row.id, runOn, awaitingPartner: true };
  }
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
  await recorded(row.id, async () => {
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
  });
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
    // Spec step 242: a big move still waiting for the partner can be undone too.
    where: { id: transferId, status: { in: ["pending", "awaiting_partner"] } },
    select: { id: true, partnerRef: true, runOn: true },
  });
  if (!row || today(row.runOn) < today(now)) {
    throw new TransferError("That transfer has already gone through or been undone.");
  }
  const movement = partner === undefined ? await moneyPartnerFor(userId, { client }) : partner;
  // A partner that says it's too late (already being processed) keeps the transfer going.
  if (movement && row.partnerRef && !(await movement.cancel(row.partnerRef))) {
    throw new TransferError("That transfer has already gone through or been undone.");
  }
  const { count } = await db.moneyTransfers.updateMany({
    where: { id: transferId, status: { in: ["pending", "awaiting_partner"] } },
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
    // A "releasing" row is one a run claimed and never finished: it is taken up again.
    where: {
      status: { in: ["pending", "releasing"] },
      runOn: { lte: new Date(`${today(now)}T00:00:00Z`) },
    },
    select: {
      id: true,
      runOn: true,
      goalId: true,
      amountCents: true,
      partnerRef: true,
      fromAccountId: true,
      toAccountId: true,
      toName: true,
      purpose: true,
      planKey: true,
    },
  });
  let settled = 0;
  for (const t of pending) {
    let partnerRef = t.partnerRef;
    // Its day has come: a partner that queues in Jane gets it now, past its undo. Claimed first
    // ("releasing"), so an Undo tap that lands meanwhile finds it no longer undoable instead of
    // cancelling a row whose transfer is being created at the partner.
    if (movement.release && partnerRef) {
      const claim = await db.moneyTransfers.updateMany({
        where: { id: t.id, status: { in: ["pending", "releasing"] } },
        data: { status: "releasing" },
      });
      if (claim.count === 0) continue;
      try {
        const released = await movement.release(partnerRef, {
          fromAccountId: t.fromAccountId,
          toAccountId: t.toAccountId,
          toName: t.toName,
          amountCents: t.amountCents,
          runOn: today(t.runOn),
          memo: t.planKey ?? t.purpose,
        });
        if (released.partnerRef !== partnerRef) {
          await db.moneyTransfers.updateMany({
            where: { id: t.id, status: "releasing" },
            data: { partnerRef: released.partnerRef },
          });
          partnerRef = released.partnerRef;
        }
      } catch (error) {
        await db.moneyTransfers.updateMany({
          where: { id: t.id, status: "releasing" },
          data: { status: "pending" },
        });
        throw error;
      }
    }
    if (!(await movement.settled({ runOn: today(t.runOn), partnerRef }, today(now)))) {
      await db.moneyTransfers.updateMany({
        where: { id: t.id, status: "releasing" },
        data: { status: "pending" },
      });
      continue;
    }
    // The completion and the goal's credit commit together: a failure between them would leave
    // the transfer done and the goal never credited, and the next run skips a completed transfer.
    const completed = await db.transaction(async (tx) => {
      const { count } = await tx.moneyTransfers.updateMany({
        where: { id: t.id, status: { in: ["pending", "releasing"] } },
        data: { status: "completed", completedAt: now },
      });
      if (count === 0) return false;
      if (t.goalId) {
        // A hand-tracked goal that has saved nothing yet holds null: start it at zero, then add.
        await tx.savingsGoals.updateMany({
          where: { id: t.goalId, accountId: null, manualSavedCents: null },
          data: { manualSavedCents: 0 },
        });
        await tx.savingsGoals.updateMany({
          where: { id: t.goalId, accountId: null },
          data: { manualSavedCents: { increment: t.amountCents } },
        });
      }
      return true;
    });
    if (completed) settled += 1;
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
    undoable:
      (r.status === "pending" || r.status === "awaiting_partner") && today(r.runOn) >= today(now),
  }));
}
