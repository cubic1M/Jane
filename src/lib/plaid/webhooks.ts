import { createHash } from "node:crypto";
import { SIGN_IN_PLAID_CODES, SYNC_LOCK_MINUTES, WEBHOOK_EVENT_DAYS } from "@/config/plaid";
import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { ITEM_STATUS, syncItem } from "./sync";

// What to do with a verified Plaid webhook (plaid.com/docs/api/items/#webhooks and the
// Transactions webhooks). Webhooks are what keep a bank fresh: SYNC_UPDATES_AVAILABLE starts a
// sync; the daily job (/api/cron/plaid-sync) is only the backstop for a missed one. Only the
// events this app uses are handled; everything else is acknowledged and ignored. Handling is
// idempotent: a delivery Plaid repeats is recognised by its body and not acted on twice, every
// change sets a state (never toggles one), and a burst of syncs for one bank runs as one.

export type WebhookPlan = { itemId: string; sync: boolean } | null;

const SYNC_CODES = new Set([
  "SYNC_UPDATES_AVAILABLE",
  "RECURRING_TRANSACTIONS_UPDATE",
  // Older transactions webhooks, still sent to some items.
  "INITIAL_UPDATE",
  "HISTORICAL_UPDATE",
  "DEFAULT_UPDATE",
  "TRANSACTIONS_REMOVED",
]);
// The bank connection needs the person to sign in again (Link's update mode): access is
// about to end, or they took it back at their bank or my.plaid.com.
const RELINK_CODES = new Set([
  "PENDING_EXPIRATION",
  "PENDING_DISCONNECT",
  "USER_PERMISSION_REVOKED",
]);

type Body = {
  webhook_type?: unknown;
  webhook_code?: unknown;
  item_id?: unknown;
  account_id?: unknown;
  error?: { error_code?: unknown } | null;
};

export async function planWebhook(
  body: Body,
  { client = defaultClient, now = new Date() }: { client?: PrismaClient; now?: Date } = {},
): Promise<WebhookPlan> {
  if (typeof body.item_id !== "string") return null;
  // Finds the item's owner; every write after this is scoped to them.
  const item = await client.plaidItem.findUnique({
    where: { plaidItemId: body.item_id },
    select: { id: true, userId: true },
  });
  if (!item) return null;
  const scoped = scopedFor(item.userId, client);
  const update = (data: Record<string, unknown>) =>
    scoped.plaidItems.updateMany({ where: { id: item.id }, data });

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
  if (body.webhook_type !== "ITEM") return null;
  const code = String(body.webhook_code);
  const errorCode = typeof body.error?.error_code === "string" ? body.error.error_code : null;
  if (
    RELINK_CODES.has(code) ||
    (code === "ERROR" && errorCode && SIGN_IN_PLAID_CODES.includes(errorCode))
  ) {
    await update({ status: ITEM_STATUS.loginRequired });
    return { itemId: item.id, sync: false };
  }
  // Any other item error (an institution outage, say): kept beside how old the data is, so the
  // person is told plainly; the next good sync clears it.
  if (code === "ERROR") {
    await update({ lastErrorCode: errorCode ?? "UNKNOWN", lastErrorAt: now });
    return { itemId: item.id, sync: false };
  }
  if (code === "LOGIN_REPAIRED") {
    await update({ status: ITEM_STATUS.active, lastErrorCode: null, lastErrorAt: null });
    return { itemId: item.id, sync: true };
  }
  // The bank has accounts the person hasn't shared: they're asked (Link's update mode with
  // account selection) and nothing else changes.
  if (code === "NEW_ACCOUNTS_AVAILABLE") {
    await update({ newAccountsAvailable: true });
    return { itemId: item.id, sync: false };
  }
  // The person stopped sharing one account: its data goes (its transactions with it).
  if (code === "USER_ACCOUNT_REVOKED" && typeof body.account_id === "string") {
    await scoped.accounts.deleteMany({
      where: { itemId: item.id, plaidAccountId: body.account_id },
    });
    return { itemId: item.id, sync: false };
  }
  return null;
}

// A webhook delivery, the first time it's seen: false when Plaid sent the same body before
// (it retries), so it's acknowledged and nothing happens twice. Old ones are forgotten.
export async function firstDelivery(
  rawBody: string,
  body: Body,
  { client = defaultClient, now = new Date() }: { client?: PrismaClient; now?: Date } = {},
): Promise<boolean> {
  const bodyHash = createHash("sha256").update(rawBody).digest("hex");
  const { count } = await client.plaidWebhookEvent.createMany({
    data: [
      {
        bodyHash,
        plaidItemId: typeof body.item_id === "string" ? body.item_id : null,
        webhookType: String(body.webhook_type ?? ""),
        webhookCode: String(body.webhook_code ?? ""),
      },
    ],
    skipDuplicates: true,
  });
  await client.plaidWebhookEvent.deleteMany({
    where: { receivedAt: { lt: new Date(now.getTime() - WEBHOOK_EVENT_DAYS * 86_400_000) } },
  });
  return count === 1;
}

// A sync from a webhook, unless one for the same bank is already running (a burst of
// SYNC_UPDATES_AVAILABLE, or one Plaid repeated): the running one reads everything up to now.
// A sync that died is taken over after SYNC_LOCK_MINUTES. Returns whether it ran.
export async function syncFromWebhook(
  itemId: string,
  {
    client = defaultClient,
    now = new Date(),
    sync = (id: string) => syncItem(id, { client }),
  }: { client?: PrismaClient; now?: Date; sync?: (itemId: string) => Promise<unknown> } = {},
): Promise<boolean> {
  const stale = new Date(now.getTime() - SYNC_LOCK_MINUTES * 60_000);
  const { count } = await client.plaidItem.updateMany({
    where: { id: itemId, OR: [{ syncingSince: null }, { syncingSince: { lt: stale } }] },
    data: { syncingSince: now },
  });
  if (count === 0) return false;
  try {
    await sync(itemId);
  } finally {
    await client.plaidItem.updateMany({ where: { id: itemId }, data: { syncingSince: null } });
  }
  return true;
}
