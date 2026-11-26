import type { PlaidApi } from "plaid";
import type { PrismaClient } from "@/generated/prisma/client";
import { logAudit, type AuditActor } from "@/lib/audit";
import { decrypt } from "@/lib/crypto";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { PlaidRequestError, plaid, plaidCall } from "./client";
import { forgetSince, removeOrphans } from "@/lib/evidence/orphans";
import { markFreshStartIfEmpty } from "@/lib/jane-agent/fresh-start";
import { forgetPrimer } from "@/lib/jane-agent/primer-cache";
import { isDemoToken } from "./demo";
import { log } from "@/lib/log";

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
  { client = defaultClient, api: given, actor = { type: "user", id: userId } }: Options = {},
): Promise<void> {
  const api = given ?? (await plaid());
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
  // and the snapshot go in forgetSince below.
  forgetPrimer(userId);
  // The bank is gone for good, so the record of it is written now: a clean-up below that fails
  // must not leave a deletion with no audit line (a retry would find no Item and stop).
  await logAudit(
    actor,
    "item_removed",
    { type: "plaid_item", id: item.id },
    {
      user_id: userId,
      institution: item.institutionName,
      reason,
      // /admin/costs counts real banks removed this month: Plaid bills them for the month too.
      demo: isDemoToken(accessToken),
    },
  );
  // Each clean-up step runs on its own: one that fails is logged and the rest still run, since the
  // bank is already gone and a retry could not reach them (the detection run also sweeps orphans).
  const demo = isDemoToken(accessToken);
  const steps: [string, () => Promise<unknown>][] = [
    // Everything worked out from that bank goes with it: findings, the decisions and actions on
    // them, ledger lines and alerts (src/lib/evidence/orphans.ts).
    ["orphans", () => removeOrphans(userId, { client })],
    // What was worked out since it was linked may stand on it: worked out again from what's left.
    ["since", () => forgetSince(db, item.createdAt, "bank", { demo })],
    // The last bank gone: the next one linked is a fresh start for Jane's messages.
    ["fresh start", () => markFreshStartIfEmpty(db, client)],
  ];
  for (const [what, step] of steps) {
    await step().catch((error) =>
      log.error("A clean-up after removing a bank failed", { step: what, error: String(error) }),
    );
  }
}
