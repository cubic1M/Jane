import type { PlaidApi } from "plaid";
import type { PrismaClient } from "@/generated/prisma/client";
import { logAudit, type AuditActor } from "@/lib/audit";
import { decrypt } from "@/lib/crypto";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { PlaidRequestError, plaid, plaidCall } from "./client";

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
    select: { id: true, accessTokenEncrypted: true, institutionName: true },
  });
  if (!item) throw new ItemMissingError();

  try {
    await plaidCall(api.itemRemove({ access_token: decrypt(item.accessTokenEncrypted) }));
  } catch (error) {
    if (!(error instanceof PlaidRequestError && error.code && ALREADY_GONE.has(error.code))) {
      throw error;
    }
  }
  // Accounts, transactions and recurring streams go with it (ON DELETE CASCADE).
  await db.plaidItems.deleteMany({ where: { id: item.id } });
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
