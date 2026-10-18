import type { PlaidApi } from "plaid";
import type { PrismaClient } from "@/generated/prisma/client";
import { logAudit } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { plaid } from "@/lib/plaid/client";
import { removePlaidItem } from "@/lib/plaid/remove";

// "Delete all my data": every linked bank is removed at Plaid first, then the user row,
// which takes every user-owned row with it (ON DELETE CASCADE). If Plaid can't be reached
// nothing local is deleted, so the person can simply try again. Only the audit log keeps
// a record, and it holds ids, not personal data.
export async function deleteAllData(
  userId: string,
  { client = defaultClient, api = plaid() }: { client?: PrismaClient; api?: PlaidApi } = {},
): Promise<void> {
  const items = await scopedFor(userId, client).plaidItems.findMany({ select: { id: true } });
  for (const item of items) {
    await removePlaidItem(userId, item.id, "user_deleted_data", { client, api });
  }
  await client.user.delete({ where: { id: userId } });
  await logAudit(
    { type: "user", id: userId },
    "user_data_deleted",
    { type: "user", id: userId },
    {
      plaid_items_removed: items.length,
    },
  );
}
