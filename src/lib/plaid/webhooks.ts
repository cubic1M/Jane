import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { ITEM_STATUS } from "./sync";

// What to do with a verified Plaid webhook. Only the events this app uses are handled;
// everything else is acknowledged and ignored.

export type WebhookPlan = { itemId: string; sync: boolean } | null;

const SYNC_CODES = new Set([
  "SYNC_UPDATES_AVAILABLE",
  "RECURRING_TRANSACTIONS_UPDATE",
  // Older transactions webhooks, still sent to some items.
  "INITIAL_UPDATE",
  "HISTORICAL_UPDATE",
  "DEFAULT_UPDATE",
]);
// The bank connection needs the person to sign in again.
const RELINK_CODES = new Set(["PENDING_EXPIRATION", "PENDING_DISCONNECT"]);
const RELINK_ERRORS = new Set(["ITEM_LOGIN_REQUIRED"]);

type Body = {
  webhook_type?: unknown;
  webhook_code?: unknown;
  item_id?: unknown;
  error?: { error_code?: unknown } | null;
};

export async function planWebhook(
  body: Body,
  { client = defaultClient }: { client?: PrismaClient } = {},
): Promise<WebhookPlan> {
  if (typeof body.item_id !== "string") return null;
  // Finds the item's owner; every write after this is scoped to them.
  const item = await client.plaidItem.findUnique({
    where: { plaidItemId: body.item_id },
    select: { id: true, userId: true },
  });
  if (!item) return null;
  const items = scopedFor(item.userId, client).plaidItems;
  const setStatus = (status: string) =>
    items.updateMany({ where: { id: item.id }, data: { status } });

  if (body.webhook_type === "TRANSACTIONS" && SYNC_CODES.has(String(body.webhook_code))) {
    return { itemId: item.id, sync: true };
  }
  // New or changed loan and card details (spec step 65) or investment balances (step 66);
  // the sync reads them again.
  if (
    (body.webhook_type === "LIABILITIES" || body.webhook_type === "HOLDINGS") &&
    body.webhook_code === "DEFAULT_UPDATE"
  ) {
    return { itemId: item.id, sync: true };
  }
  if (body.webhook_type === "ITEM") {
    const code = String(body.webhook_code);
    if (
      RELINK_CODES.has(code) ||
      (code === "ERROR" && RELINK_ERRORS.has(String(body.error?.error_code)))
    ) {
      await setStatus(ITEM_STATUS.loginRequired);
      return { itemId: item.id, sync: false };
    }
    if (code === "LOGIN_REPAIRED") {
      await setStatus(ITEM_STATUS.active);
      return { itemId: item.id, sync: true };
    }
  }
  return null;
}
