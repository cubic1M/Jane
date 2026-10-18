import type { PlaidApi, TransactionStream } from "plaid";
import { categorizeTransactions } from "@/categorize/categorize";
import { PlaidDataSource, toCents, type PlaidSync } from "@/data-sources/plaid/plaid-source";
import { ACCOUNT_KINDS } from "@/data-sources/types";
import { runDetection } from "@/detection/engine";
import type { PrismaClient } from "@/generated/prisma/client";
import { track } from "@/lib/analytics";
import { decrypt } from "@/lib/crypto";
import { db as defaultClient } from "@/lib/db";
import { scopedFor, type ScopedDb } from "@/lib/db-scoped";
import { explainFindings } from "@/lib/explanations";
import { plaid, plaidCall, plaidErrorCode } from "./client";

// Brings one Plaid item up to date: accounts, transactions since the saved cursor
// (added, modified and removed), recurring streams, then detection and explanations,
// exactly as after a CSV import. Runs without a session (webhooks, the daily job), so it
// scopes every query to the item's owner.

export const ITEM_STATUS = {
  active: "active",
  // The bank needs the person to sign in again (Link update mode).
  loginRequired: "login_required",
} as const;

export type SyncResult = {
  accounts: number;
  added: number;
  updated: number;
  removed: number;
  firstSync: boolean;
  recurring: "updated" | "unavailable";
};

type Options = { client?: PrismaClient; api?: PlaidApi; now?: Date };

async function saveAccounts(db: ScopedDb, itemId: string, sync: PlaidSync) {
  const ids = new Map<string, string>();
  for (const account of sync.accounts) {
    const saved = await db.accounts.upsert({
      where: { plaidAccountId: account.ref },
      create: {
        userId: db.userId,
        source: "plaid",
        itemId,
        plaidAccountId: account.ref,
        name: account.name,
        mask: account.mask,
        type: ACCOUNT_KINDS[account.kind].type,
        subtype: ACCOUNT_KINDS[account.kind].subtype,
        currentBalanceCents: account.currentBalanceCents,
      },
      update: {
        name: account.name,
        mask: account.mask,
        currentBalanceCents: account.currentBalanceCents,
      },
      select: { id: true },
    });
    ids.set(account.ref, saved.id);
  }
  return ids;
}

async function saveTransactions(db: ScopedDb, accountIds: Map<string, string>, sync: PlaidSync) {
  const categorized = await categorizeTransactions(sync.transactions, db);
  const rows = categorized.flatMap((t) => {
    const accountId = accountIds.get(t.accountRef);
    if (!accountId) return [];
    return [
      {
        plaidTransactionId: t.externalId,
        accountId,
        date: new Date(`${t.date}T00:00:00Z`),
        amountCents: t.amountCents,
        description: t.description,
        merchantName: t.merchantName,
        pfcPrimary: t.category?.primary ?? null,
        pfcDetailed: t.category?.detailed ?? null,
        categorySource: t.categorySource,
        pending: t.pending,
      },
    ];
  });

  const existing = new Set(
    (
      await db.transactions.findMany({
        where: { plaidTransactionId: { in: rows.map((r) => r.plaidTransactionId) } },
        select: { plaidTransactionId: true },
      })
    ).map((t) => t.plaidTransactionId),
  );
  const fresh = rows.filter((r) => !existing.has(r.plaidTransactionId));
  const changed = rows.filter((r) => existing.has(r.plaidTransactionId));

  const { count: added } = await db.transactions.createMany({
    data: fresh.map((r) => ({ ...r, userId: db.userId, source: "plaid" as const })),
    skipDuplicates: true,
  });
  for (const { plaidTransactionId, ...data } of changed) {
    await db.transactions.updateMany({ where: { plaidTransactionId }, data });
  }
  const { count: removed } =
    sync.removedTransactionIds.length > 0
      ? await db.transactions.deleteMany({
          where: { plaidTransactionId: { in: sync.removedTransactionIds } },
        })
      : { count: 0 };
  return { added, updated: changed.length, removed };
}

function streamRow(stream: TransactionStream, accountId: string) {
  return {
    accountId,
    merchantName: stream.merchant_name ?? stream.description ?? null,
    frequency: stream.frequency,
    lastAmountCents: toCents(stream.last_amount.amount) ?? 0,
    averageAmountCents: toCents(stream.average_amount.amount) ?? 0,
    lastDate: stream.last_date ? new Date(`${stream.last_date}T00:00:00Z`) : null,
    predictedNextDate: stream.predicted_next_date
      ? new Date(`${stream.predicted_next_date}T00:00:00Z`)
      : null,
    status: stream.status,
    isActive: stream.is_active,
    pfcPrimary: stream.personal_finance_category?.primary ?? null,
    pfcDetailed: stream.personal_finance_category?.detailed ?? null,
    transactionIds: stream.transaction_ids,
  };
}

// Plaid's recurring streams for the item. The endpoint is an add-on; when it isn't
// enabled, detection finds recurring charges itself, so this only warns.
async function saveRecurringStreams(
  db: ScopedDb,
  api: PlaidApi,
  accessToken: string,
  accountIds: Map<string, string>,
): Promise<SyncResult["recurring"]> {
  let streams: TransactionStream[];
  try {
    const data = await plaidCall(api.transactionsRecurringGet({ access_token: accessToken }));
    streams = [...data.outflow_streams, ...data.inflow_streams];
  } catch (error) {
    const code = plaidErrorCode(error);
    if (!code) throw error;
    console.warn("Plaid recurring transactions unavailable; using our own detection", { code });
    return "unavailable";
  }

  const kept: string[] = [];
  for (const stream of streams) {
    const accountId = accountIds.get(stream.account_id);
    if (!accountId) continue;
    const row = streamRow(stream, accountId);
    await db.recurringStreams.upsert({
      where: { plaidStreamId: stream.stream_id },
      create: { ...row, userId: db.userId, plaidStreamId: stream.stream_id },
      update: row,
    });
    kept.push(stream.stream_id);
  }
  await db.recurringStreams.deleteMany({
    where: { accountId: { in: [...accountIds.values()] }, plaidStreamId: { notIn: kept } },
  });
  return "updated";
}

export async function syncItem(
  itemId: string,
  { client = defaultClient, api = plaid(), now = new Date() }: Options = {},
): Promise<SyncResult> {
  // The one unscoped read: finds the item's owner so everything after is scoped to them.
  const item = await client.plaidItem.findUnique({
    where: { id: itemId },
    select: { id: true, userId: true, accessTokenEncrypted: true, transactionsCursor: true },
  });
  if (!item) throw new Error("Plaid item not found");
  const db = scopedFor(item.userId, client);
  const accessToken = decrypt(item.accessTokenEncrypted);

  const sync = await new PlaidDataSource(api, accessToken, item.transactionsCursor).load();
  const accountIds = await saveAccounts(db, item.id, sync);
  const counts = await saveTransactions(db, accountIds, sync);
  const recurring = await saveRecurringStreams(db, api, accessToken, accountIds);

  await db.plaidItems.updateMany({
    where: { id: item.id },
    data: { transactionsCursor: sync.nextCursor, lastSyncedAt: now, status: ITEM_STATUS.active },
  });

  const result: SyncResult = {
    accounts: accountIds.size,
    ...counts,
    firstSync: item.transactionsCursor === null,
    recurring,
  };
  if (result.firstSync) {
    await track(item.userId, "first_sync_completed", {
      accounts: result.accounts,
      transactions: result.added,
      recurring,
    });
  }

  await runDetection(item.userId, { client, now });
  await explainFindings(item.userId, { client });
  return result;
}
