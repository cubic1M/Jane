import type { PlaidApi, TransactionStream } from "plaid";
import { categorizeTransactions } from "@/categorize/categorize";
import { normalizeLiabilities } from "@/data-sources/plaid/liabilities";
import {
  PlaidDataSource,
  normalizeAccount,
  toCents,
  type PlaidSync,
} from "@/data-sources/plaid/plaid-source";
import { SYNCED_KINDS, type NormalizedAccount } from "@/data-sources/types";
import { runDetection } from "@/detection/engine";
import type { PrismaClient } from "@/generated/prisma/client";
import { track } from "@/lib/analytics";
import { decrypt } from "@/lib/crypto";
import { db as defaultClient } from "@/lib/db";
import { scopedFor, type ScopedDb } from "@/lib/db-scoped";
import { enqueueJob, runJob } from "@/lib/jobs";
import { plaid, plaidCall, plaidErrorCode } from "./client";
import { DEMO_OPTIONS } from "@/data-sources/demo/demo-options";
import type { DemoSwitch } from "@/data-sources/demo/demo-bank";
import { confirmSwitches, switchOf } from "@/lib/agent/switch";
import { ensureDemoOptions } from "@/lib/compare";
import { demoPlaidApi, isDemoToken } from "./demo";

// Brings one Plaid item up to date: accounts, transactions since the saved cursor
// (added, modified and removed), recurring streams, loans and card rates (Liabilities,
// when the item was linked with it), then detection and explanations,
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
  // "off" for items linked before Liabilities was asked for.
  liabilities: "updated" | "unavailable" | "off";
  // Investment and retirement balances (spec step 66); "off" as above.
  investments: "updated" | "unavailable" | "off";
};

type Options = { client?: PrismaClient; api?: PlaidApi; now?: Date };

async function saveAccounts(db: ScopedDb, itemId: string, sync: { accounts: NormalizedAccount[] }) {
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
        type: SYNCED_KINDS[account.kind].type,
        subtype: SYNCED_KINDS[account.kind].subtype,
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

  const saved = await db.transactions.findMany({
    where: { plaidTransactionId: { in: rows.map((r) => r.plaidTransactionId) } },
    select: { plaidTransactionId: true, categorySource: true },
  });
  const existing = new Set(saved.map((t) => t.plaidTransactionId));
  // Categories the person set by hand survive Plaid's later changes to the transaction.
  const corrected = new Set(
    saved.filter((t) => t.categorySource === "user").map((t) => t.plaidTransactionId),
  );
  const fresh = rows.filter((r) => !existing.has(r.plaidTransactionId));
  const changed = rows.filter((r) => existing.has(r.plaidTransactionId));

  const { count: added } = await db.transactions.createMany({
    data: fresh.map((r) => ({ ...r, userId: db.userId, source: "plaid" as const })),
    skipDuplicates: true,
  });
  for (const { plaidTransactionId, ...data } of changed) {
    const { pfcPrimary, pfcDetailed, categorySource, ...rest } = data;
    await db.transactions.updateMany({
      where: { plaidTransactionId },
      data:
        corrected.has(plaidTransactionId) && categorySource !== "user"
          ? rest
          : { ...rest, pfcPrimary, pfcDetailed, categorySource },
    });
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

const day = (value: string | null) => (value ? new Date(`${value}T00:00:00Z`) : null);

// Rates, payments and due dates for the item's cards and loans (spec step 65). Like
// recurring streams, a Plaid error here (the bank doesn't support it, the person has no
// such accounts) only warns: the rest of the sync stands.
async function saveLiabilities(
  db: ScopedDb,
  api: PlaidApi,
  accessToken: string,
  itemId: string,
): Promise<SyncResult["liabilities"]> {
  let data;
  try {
    data = await plaidCall(api.liabilitiesGet({ access_token: accessToken }));
  } catch (error) {
    const code = plaidErrorCode(error);
    if (!code) throw error;
    console.warn("Plaid liabilities unavailable", { code });
    return "unavailable";
  }
  // Fresh balances, and the loan accounts themselves if the transactions sync had none.
  const accountIds = await saveAccounts(db, itemId, {
    accounts: data.accounts.map(normalizeAccount).filter((a): a is NormalizedAccount => a !== null),
  });
  const kept: string[] = [];
  for (const l of normalizeLiabilities(data.liabilities)) {
    const accountId = accountIds.get(l.accountRef);
    if (!accountId) continue;
    const row = {
      kind: l.kind,
      aprBps: l.aprBps,
      rateType: l.rateType,
      minimumPaymentCents: l.minimumPaymentCents,
      nextPaymentDueDate: day(l.nextPaymentDueDate),
      lastPaymentCents: l.lastPaymentCents,
      lastPaymentDate: day(l.lastPaymentDate),
      originationPrincipalCents: l.originationPrincipalCents,
      originationDate: day(l.originationDate),
      payoffDate: day(l.payoffDate),
      isOverdue: l.isOverdue,
      pastDueCents: l.pastDueCents,
      ytdInterestPaidCents: l.ytdInterestPaidCents,
      description: l.description,
    };
    await db.liabilities.upsert({
      where: { accountId },
      create: { ...row, userId: db.userId, accountId },
      update: row,
    });
    kept.push(accountId);
  }
  // A card or loan the bank no longer reports keeps its account, but not stale details.
  await db.liabilities.deleteMany({
    where: { account: { itemId }, accountId: { notIn: kept } },
  });
  return "updated";
}

// The person's switches in progress, for the demo bank to answer (spec step 77).
async function demoSwitches(db: ScopedDb): Promise<DemoSwitch[]> {
  const actions = await db.actions.findMany({
    where: { agentState: "switching", startedAt: { not: null } },
    select: {
      id: true,
      startedAt: true,
      decision: { select: { options: true, finding: { select: { evidence: true } } } },
    },
  });
  return actions.flatMap((a) => {
    const sw = switchOf(a.decision.options);
    const options = (a.decision.options ?? {}) as { switchTo?: unknown };
    if (!sw || typeof options.switchTo !== "string") return [];
    const merchant = (a.decision.finding.evidence as { merchant?: unknown } | null)?.merchant;
    return [
      {
        actionId: a.id,
        kind: sw.kind,
        provider: sw.provider,
        company: typeof merchant === "string" ? merchant : null,
        category: DEMO_OPTIONS.find((o) => o.id === options.switchTo)?.category ?? null,
        monthlyCents: sw.monthlyCents,
        amountCents: sw.amountCents,
        startDay: a.startedAt!.toISOString().slice(0, 10),
      },
    ];
  });
}

// Investment and retirement balances (spec step 66): the accounts only, for net worth.
// Plaid's holdings and securities come back too, and are dropped: Jane says nothing about
// what's in an account. An error only warns, like liabilities.
async function saveInvestmentBalances(
  db: ScopedDb,
  api: PlaidApi,
  accessToken: string,
  itemId: string,
): Promise<SyncResult["investments"]> {
  let accounts: NormalizedAccount[];
  try {
    const data = await plaidCall(api.investmentsHoldingsGet({ access_token: accessToken }));
    accounts = data.accounts
      .map((a) => normalizeAccount(a))
      .filter((a): a is NormalizedAccount => a !== null);
  } catch (error) {
    const code = plaidErrorCode(error);
    if (!code) throw error;
    console.warn("Plaid investments unavailable", { code });
    return "unavailable";
  }
  await saveAccounts(db, itemId, { accounts });
  return "updated";
}

export async function syncItem(
  itemId: string,
  { client = defaultClient, api = plaid(), now = new Date() }: Options = {},
): Promise<SyncResult> {
  // The one unscoped read: finds the item's owner so everything after is scoped to them.
  const item = await client.plaidItem.findUnique({
    where: { id: itemId },
    select: {
      id: true,
      userId: true,
      accessTokenEncrypted: true,
      transactionsCursor: true,
      liabilities: true,
      investments: true,
    },
  });
  if (!item) throw new Error("Plaid item not found");
  const db = scopedFor(item.userId, client);
  const accessToken = decrypt(item.accessTokenEncrypted);
  // The demo bank (spec step 75) answers in Plaid's place; everything after is the same.
  if (isDemoToken(accessToken)) {
    api = demoPlaidApi(accessToken, now, await demoSwitches(db));
    // Its example options to compare against (spec step 76).
    await ensureDemoOptions({ client, now });
  }

  const sync = await new PlaidDataSource(api, accessToken, item.transactionsCursor).load();
  const accountIds = await saveAccounts(db, item.id, sync);
  const counts = await saveTransactions(db, accountIds, sync);
  const recurring = await saveRecurringStreams(db, api, accessToken, accountIds);
  const liabilities = item.liabilities
    ? await saveLiabilities(db, api, accessToken, item.id)
    : "off";
  const investments = item.investments
    ? await saveInvestmentBalances(db, api, accessToken, item.id)
    : "off";

  await db.plaidItems.updateMany({
    where: { id: item.id },
    data: { transactionsCursor: sync.nextCursor, lastSyncedAt: now, status: ITEM_STATUS.active },
  });

  const result: SyncResult = {
    accounts: accountIds.size,
    ...counts,
    firstSync: item.transactionsCursor === null,
    recurring,
    liabilities,
    investments,
  };
  if (result.firstSync) {
    await track(item.userId, "first_sync_completed", {
      accounts: result.accounts,
      transactions: result.added,
      recurring,
      liabilities,
      investments,
    });
  }

  await runDetection(item.userId, { client, now });
  // New charges may show that a switch went through (spec step 77).
  await confirmSwitches({ client, now, userId: item.userId });
  // Card text from Claude, as a job: retried later if it fails, without failing the sync.
  await runJob(await enqueueJob("explain_findings", { userId: item.userId }, { client }), {
    client,
  });
  return result;
}
