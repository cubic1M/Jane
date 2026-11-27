import {
  CLAIM_LEASE_MS,
  TRANSFER_DELAY_DAYS,
  UNSCHEDULED_RESERVATION_MS,
} from "@/config/money-movement";
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
  // One transfer for one move of a plan (money_transfers.unique_key): asked for twice, the second
  // call returns the first's transfer and schedules nothing.
  uniqueKey?: string | null;
  runOn?: string;
};

export class TransferError extends Error {}

// A move saved ahead of the partner call whose answer has not come yet: asking again is a retry later, not
// a refusal.
export class TransferInFlightError extends TransferError {}

type Scheduled = { id: string; runOn: string; awaitingPartner?: boolean };
const isScheduled = (row: { id: string } | Scheduled): row is Scheduled => "runOn" in row;
const isUniqueClash = (error: unknown) => (error as { code?: string } | null)?.code === "P2002";

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
  const uniqueKey = transfer.uniqueKey ?? null;
  // The same move of a plan asked for again (a retry, two taps at once) finds the first transfer.
  const firstOfKey = async (): Promise<Scheduled | null> => {
    if (!uniqueKey) return null;
    const found = await db.moneyTransfers.findFirst({
      where: { uniqueKey },
      select: { id: true, runOn: true, status: true, partnerRef: true },
    });
    // A move saved ahead of the partner call that has no reference yet is not scheduled: whoever
    // asks again is told it is still being sent, never handed an id that may never go anywhere.
    if (found && found.status === "pending" && !found.partnerRef) {
      throw new TransferInFlightError("That move is still being sent. Try again in a minute.");
    }
    // A move the partner never confirmed keeps its key so it cannot be sent a second time.
    if (found && found.status === "failed") {
      throw new TransferError(
        "That move could not be confirmed with the partner, so Jane will not send it again on its own.",
      );
    }
    return found
      ? {
          id: found.id,
          runOn: today(found.runOn),
          ...(found.status === "awaiting_partner" ? { awaitingPartner: true } : {}),
        }
      : null;
  };
  const already = await firstOfKey();
  if (already) return already;
  const rowData = {
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
    by,
    planKey: transfer.planKey ?? null,
    uniqueKey,
    createdAt: now,
  };
  // The key is taken before the partner is asked, so a second caller cannot schedule the same
  // money while the first waits on the partner.
  const take = async (status: string): Promise<{ id: string } | Scheduled> => {
    try {
      return await db.moneyTransfers.create({
        data: { ...rowData, status, partnerRef: null },
        select: { id: true },
      });
    } catch (error) {
      if (!isUniqueClash(error)) throw error;
      const first = await firstOfKey();
      if (first) return first;
      throw error;
    }
  };
  if (both) {
    const row = await take("awaiting_partner");
    if (isScheduled(row)) return row;
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
  // A transfer with a key is saved first, with no partner reference yet (settling leaves it alone
  // until it has one); one without is saved after the partner has it, as it always was.
  const reserved = uniqueKey ? await take("pending") : null;
  if (reserved && isScheduled(reserved)) return reserved;
  let partnerRef: string;
  try {
    ({ partnerRef } = await movement.schedule({
      fromAccountId: transfer.fromAccountId,
      toAccountId: transfer.toAccountId,
      toName: transfer.toName,
      amountCents: transfer.amountCents,
      runOn,
      memo: transfer.planKey ?? transfer.purpose,
    }));
  } catch (error) {
    // Not scheduled: the move can be tried again.
    if (reserved) {
      await db.moneyTransfers.updateMany({
        where: { id: reserved.id, status: "pending" },
        data: { status: "failed", uniqueKey: null },
      });
    }
    throw error;
  }
  if (reserved) {
    const { count } = await db.moneyTransfers.updateMany({
      where: { id: reserved.id, status: "pending" },
      data: { partnerRef },
    });
    if (count === 0) {
      // The reservation was closed while the partner was answering: what it returned is undone
      // at the partner rather than dropped.
      await movement.cancel(partnerRef).catch(() => false);
      throw new TransferError("That move was closed while it was being sent. Try it again.");
    }
  }
  const row =
    reserved ??
    (await db.moneyTransfers.create({
      data: { ...rowData, status: "pending", partnerRef },
      select: { id: true },
    }));
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
    select: { id: true, partnerRef: true, runOn: true, status: true },
  });
  if (!row || today(row.runOn) < today(now)) {
    throw new TransferError("That transfer has already gone through or been undone.");
  }
  // A move saved ahead of the partner call has no reference until the partner answers: undoing it
  // now could free its key while the partner still takes it.
  if (row.status === "pending" && !row.partnerRef) {
    throw new TransferError("That transfer is still being sent. Try again in a minute.");
  }
  const movement = partner === undefined ? await moneyPartnerFor(userId, { client }) : partner;
  // A partner that says it's too late (already being processed) keeps the transfer going.
  if (movement && row.partnerRef && !(await movement.cancel(row.partnerRef))) {
    throw new TransferError("That transfer has already gone through or been undone.");
  }
  const { count } = await db.moneyTransfers.updateMany({
    where: { id: transferId, status: { in: ["pending", "awaiting_partner"] } },
    data: { status: "cancelled", cancelledAt: now, uniqueKey: null },
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
  // A move saved ahead of the partner call (a unique key, no partner reference) that has waited
  // this long never reached the partner: it is failed, which frees its key for a new try.
  const unconfirmed = await db.moneyTransfers.findMany({
    where: {
      status: "pending",
      uniqueKey: { not: null },
      partnerRef: null,
      createdAt: { lt: new Date(now.getTime() - UNSCHEDULED_RESERVATION_MS) },
    },
    select: { id: true },
  });
  for (const { id } of unconfirmed) {
    // Failed, but the key stays: the partner may have taken it and the reference write been lost,
    // so asking again would send the money twice. Asking again says it could not be confirmed.
    const { count } = await db.moneyTransfers.updateMany({
      where: { id, status: "pending", partnerRef: null },
      data: { status: "failed" },
    });
    if (count > 0) {
      await recorded(id, () =>
        logAudit(
          { type: "user", id: userId },
          "money_transfer_unconfirmed",
          { type: "money_transfer", id },
          {},
        ),
      );
    }
  }
  const pending = await db.moneyTransfers.findMany({
    // A "releasing" row is one a run claimed and never finished: it is taken up again. A move
    // still waiting on the partner call has no reference yet and is left alone.
    where: {
      status: { in: ["pending", "releasing"] },
      NOT: { uniqueKey: { not: null }, partnerRef: null },
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
  // A lease runs from the moment its claim is written, not from the start of the run: a long run
  // would otherwise write leases that are already over.
  const startedMs = Date.now();
  const at = () => new Date(now.getTime() + (Date.now() - startedMs));
  for (const t of pending) {
    let partnerRef = t.partnerRef;
    let leaseEnd: Date | null = null;
    // Its day has come: a partner that queues in Jane gets it now, past its undo. Claimed first
    // ("releasing"), so an Undo tap that lands meanwhile finds it no longer undoable instead of
    // cancelling a row whose transfer is being created at the partner.
    if (movement.release && partnerRef) {
      // A claim another run still holds is left to it; one past its end (or with none, as on
      // rows from before the lease) is taken over, and held again from now.
      const claimedAt = at();
      const claimUntil = new Date(claimedAt.getTime() + CLAIM_LEASE_MS);
      const claim = await db.moneyTransfers.updateMany({
        where: {
          id: t.id,
          OR: [
            { status: "pending" },
            {
              status: "releasing",
              OR: [{ claimExpiresAt: null }, { claimExpiresAt: { lt: claimedAt } }],
            },
          ],
        },
        data: { status: "releasing", claimExpiresAt: claimUntil },
      });
      if (claim.count === 0) continue;
      leaseEnd = claimUntil;
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
            where: { id: t.id, status: "releasing", claimExpiresAt: leaseEnd },
            data: { partnerRef: released.partnerRef },
          });
          partnerRef = released.partnerRef;
        }
      } catch (error) {
        await db.moneyTransfers.updateMany({
          where: { id: t.id, status: "releasing", claimExpiresAt: leaseEnd },
          data: { status: "pending", claimExpiresAt: null },
        });
        throw error;
      }
    }
    if (!(await movement.settled({ runOn: today(t.runOn), partnerRef }, today(now)))) {
      // Only the lease this run took: a run that lost its claim must not clear the new holder's.
      await db.moneyTransfers.updateMany({
        where: leaseEnd
          ? { id: t.id, status: "releasing", claimExpiresAt: leaseEnd }
          : { id: t.id, status: "releasing" },
        data: { status: "pending", claimExpiresAt: null },
      });
      continue;
    }
    // The completion and the goal's credit commit together: a failure between them would leave
    // the transfer done and the goal never credited, and the next run skips a completed transfer.
    const completed = await db.transaction(async (tx) => {
      const { count } = await tx.moneyTransfers.updateMany({
        where: { id: t.id, status: { in: ["pending", "releasing"] } },
        data: { status: "completed", completedAt: now, claimExpiresAt: null },
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
