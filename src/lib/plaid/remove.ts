import type { PlaidApi } from "plaid";
import type { PrismaClient } from "@/generated/prisma/client";
import { logAudit, type AuditActor } from "@/lib/audit";
import { decrypt } from "@/lib/crypto";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { PlaidRequestError, plaid, plaidCall } from "./client";
import { forgetSince, removeOrphans } from "@/lib/evidence/orphans";
import { forgetPrimer } from "@/lib/jane-agent/primer-cache";
import { isDemoToken } from "./demo";

// Removes a linked bank: tells Plaid (/item/remove, which also stops billing for it),
// then deletes the item with its accounts, transactions and streams.

// Plaid answers these when the item is already gone, which is the outcome we want.
const ALREADY_GONE = new Set(["ITEM_NOT_FOUND", "INVALID_ACCESS_TOKEN"]);

export type RemovalReason = "user_disconnected" | "user_deleted_data" | "inactive";

type Options = { client?: PrismaClient; api?: PlaidApi; actor?: AuditActor };

export class ItemMissingError extends Error {
  constructor() {
    super("That linked bank doesn't exist.");
  }
}

export async function removePlaidItem(
  userId: string,
  itemId: string,
  reason: RemovalReason,
  { client = defaultClient, api = plaid(), actor = { type: "user", id: userId } }: Options = {},
): Promise<void> {
  const db = scopedFor(userId, client);
  const item = await db.plaidItems.findFirst({
    where: { id: itemId },
    select: { id: true, accessTokenEncrypted: true, institutionName: true, createdAt: true },
  });
  if (!item) throw new ItemMissingError();

  const accessToken = decrypt(item.accessTokenEncrypted);
  try {
    // A demo bank (spec step 75) has nothing at Plaid to remove.
    if (!isDemoToken(accessToken)) await plaidCall(api.itemRemove({ access_token: accessToken }));
  } catch (error) {
    if (!(error instanceof PlaidRequestError && error.code && ALREADY_GONE.has(error.code))) {
      throw error;
    }
  }
  // Accounts, transactions and recurring streams go with it (ON DELETE CASCADE).
  await db.plaidItems.deleteMany({ where: { id: item.id } });
  // The chat's copy of the numbers had that bank's in it (card-chat mismatch). The saved copy
  // and the snapshot are refused from now on by their data stamp (src/lib/data-stamp.ts).
  forgetPrimer(userId);
  // And everything worked out from that bank goes with it: findings, the decisions and actions
  // on them, ledger lines and alerts (src/lib/evidence/orphans.ts).
  await removeOrphans(userId, { client });
  // What was worked out since it was linked may stand on it: worked out again from what's left.
  await forgetSince(db, item.createdAt, "bank", { demo: isDemoToken(accessToken) });
  await logAudit(
    actor,
    "item_removed",
    { type: "plaid_item", id: item.id },
    {
      user_id: userId,
      institution: item.institutionName,
      reason,
    },
  );
}
