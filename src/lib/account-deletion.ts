import { ACCESS_EVENTS } from "@/config/access-log";
import type { PlaidApi } from "plaid";
import type { PrismaClient } from "@/generated/prisma/client";
import { logAudit } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { plaid } from "@/lib/plaid/client";
import { removePlaidItem } from "@/lib/plaid/remove";
import { deleteTrialPerson } from "@/lib/trial-delete";
import { isStatementTrialUser } from "@/lib/trial-ids";

// "Delete all my data": every linked bank is removed at Plaid first, then the user row,
// which takes every user-owned row with it (ON DELETE CASCADE), the beta's activity log
// (activity_events) included. If Plaid can't be reached
// nothing local is deleted, so the person can simply try again. Only the audit log keeps
// a record (with the time, IP address and browser, like every access-log entry).
export async function deleteAllData(
  userId: string,
  { client = defaultClient, api = plaid() }: { client?: PrismaClient; api?: PlaidApi } = {},
): Promise<void> {
  // A temporary try has no bank, and goes the one way that leaves only its start and delete record.
  if (isStatementTrialUser(userId)) {
    await deleteTrialPerson(userId, "start_over", { client });
    return;
  }
  const items = await scopedFor(userId, client).plaidItems.findMany({ select: { id: true } });
  for (const item of items) {
    await removePlaidItem(userId, item.id, "user_deleted_data", { client, api });
  }
  // Shared bills belong to the household, not the user row, so they're ended here, as when
  // someone leaves; the partner keeps the household and their own data.
  const membership = await client.householdMember.findUnique({
    where: { userId },
    select: { householdId: true },
  });
  // The closed beta's lists are keyed by email, not the user row: the invite they used and
  // any waitlist entry go too (a new account would need a new invite).
  const user = await client.user.findUnique({ where: { id: userId }, select: { email: true } });
  await client.$transaction(async (tx) => {
    if (user?.email) {
      await tx.betaAccess.deleteMany({ where: { email: user.email } });
      await tx.waitlistEntry.deleteMany({ where: { email: user.email } });
      // Request counters keyed by the email or the id: "You can delete everything" (/privacy), so
      // not a day later, when they'd expire (debugger 11-03).
      await tx.rateLimit.deleteMany({
        where: {
          OR: [
            { key: { endsWith: `:email:${user.email.toLowerCase()}` } },
            { key: { endsWith: `:${userId}` } },
          ],
        },
      });
    }
    // Their share link stops working and forgets the card it showed. The code stays, so
    // friends who already redeemed it keep their place.
    await tx.inviteCode.updateMany({
      where: { sharedById: userId },
      data: { revokedAt: new Date(), sharedById: null, cardKind: null, cardValue: null },
    });
    if (membership) {
      const where = { where: { householdId: membership.householdId } };
      await tx.sharedCharge.deleteMany(where);
      await tx.settlement.deleteMany(where);
    }
    // /privacy says only a record that the deletion happened stays, in the security log. The rest of
    // the audit log holds things like a medical provider or a tax tag, and has no tie to the user
    // row to go with it.
    await tx.auditLog.deleteMany({
      where: {
        OR: [
          { actorId: userId },
          { targetId: userId },
          { metadata: { path: ["user_id"], equals: userId } },
        ],
        event: { notIn: [...ACCESS_EVENTS] },
        // What someone did as the team isn't theirs to erase by deleting their account.
        actorType: { not: "admin" },
      },
    });
    await tx.user.delete({ where: { id: userId } });
  });
  await logAudit(
    { type: "user", id: userId },
    "user_data_deleted",
    { type: "user", id: userId },
    {
      plaid_items_removed: items.length,
    },
  );
}
