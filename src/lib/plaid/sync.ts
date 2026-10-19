import type { Holding, InvestmentTransaction, PlaidApi, TransactionStream } from "plaid";
import { categorizeTransactions } from "@/categorize/categorize";
import { normalizeLiabilities } from "@/data-sources/plaid/liabilities";
import {
  PlaidDataSource,
  normalizeAccount,
  toCents,
  type PlaidSync,
} from "@/data-sources/plaid/plaid-source";
import {
  normalizeHolding,
  normalizeInvestmentTransaction,
  normalizeSecurity,
  type NormalizedSecurity,
} from "@/data-sources/plaid/investments";
import { SYNCED_KINDS, type NormalizedAccount } from "@/data-sources/types";
import {
  INVESTMENT_HISTORY_DAYS,
  INVESTMENT_RESYNC_DAYS,
  INVESTMENT_TRANSACTIONS_PAGE,
} from "@/config/funds";
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
import { ensureDemoPolicies } from "@/lib/insurance/profile";
import { reshopPerson } from "@/lib/insurance/shop";
import { demoPlaidApi, isDemoToken } from "./demo";
import { runJaneAgentSafely } from "@/lib/jane-agent/run";

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
  // Investment and retirement balances (spec step 66) and holdings (step 128); "off" as
  // above.
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
        subtype: account.plaidSubtype ?? SYNCED_KINDS[account.kind].subtype,
        currentBalanceCents: account.currentBalanceCents,
      },
      update: {
        name: account.name,
        mask: account.mask,
        currentBalanceCents: account.currentBalanceCents,
        // Investment accounts keep Plaid's own subtype (spec step 128).
        ...(account.plaidSubtype ? { subtype: account.plaidSubtype } : {}),
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

// Investment and retirement accounts (spec step 66) and what they hold (spec step 128):
// the balances for net worth, then the securities and holdings, replaced each time, and
// the investment transactions since the last sync. An error only warns, like liabilities;
// a failure reading the transactions keeps the holdings.
async function saveInvestments(
  db: ScopedDb,
  api: PlaidApi,
  accessToken: string,
  itemId: string,
  now: Date,
): Promise<SyncResult["investments"]> {
  let holdings: Awaited<ReturnType<PlaidApi["investmentsHoldingsGet"]>>["data"];
  try {
    holdings = await plaidCall(api.investmentsHoldingsGet({ access_token: accessToken }));
  } catch (error) {
    const code = plaidErrorCode(error);
    if (!code) throw error;
    console.warn("Plaid investments unavailable", { code });
    return "unavailable";
  }
  const accounts = holdings.accounts
    .map((a) => normalizeAccount(a))
    .filter((a): a is NormalizedAccount => a !== null);
  const accountIds = await saveAccounts(db, itemId, { accounts });
  const securityIds = await saveSecurities(db, holdings.securities.map(normalizeSecurity));
  await saveHoldings(db, accountIds, securityIds, holdings.holdings);
  await saveInvestmentTransactions(db, api, accessToken, accountIds, securityIds, now);
  return "updated";
}

async function saveSecurities(db: ScopedDb, securities: NormalizedSecurity[]) {
  const ids = new Map<string, string>();
  for (const s of securities) {
    const data = {
      name: s.name,
      ticker: s.ticker,
      type: s.type,
      subtype: s.subtype,
      isCashEquivalent: s.isCashEquivalent,
      closePriceCents: s.closePriceCents,
      closePriceAsOf: s.closePriceAsOf ? new Date(`${s.closePriceAsOf}T00:00:00Z`) : null,
      sector: s.sector,
    };
    const saved = await db.securities.upsert({
      where: { userId_plaidSecurityId: { userId: db.userId, plaidSecurityId: s.ref } },
      create: { userId: db.userId, plaidSecurityId: s.ref, ...data },
      update: data,
      select: { id: true },
    });
    ids.set(s.ref, saved.id);
  }
  return ids;
}

async function saveHoldings(
  db: ScopedDb,
  accountIds: Map<string, string>,
  securityIds: Map<string, string>,
  holdings: Holding[],
) {
  const kept = new Map<string, string[]>([...accountIds.values()].map((id) => [id, []]));
  for (const h of holdings.map(normalizeHolding)) {
    const accountId = h && accountIds.get(h.accountRef);
    const securityId = h && securityIds.get(h.securityRef);
    if (!h || !accountId || !securityId) continue;
    const data = {
      quantity: h.quantity,
      priceCents: h.priceCents,
      priceAsOf: h.priceAsOf ? new Date(`${h.priceAsOf}T00:00:00Z`) : null,
      valueCents: h.valueCents,
      costBasisCents: h.costBasisCents,
    };
    await db.holdings.upsert({
      where: { accountId_securityId: { accountId, securityId } },
      create: { userId: db.userId, accountId, securityId, ...data },
      update: data,
    });
    kept.get(accountId)?.push(securityId);
  }
  // Whatever an account no longer holds.
  for (const [accountId, securities] of kept) {
    await db.holdings.deleteMany({ where: { accountId, securityId: { notIn: securities } } });
  }
}

async function saveInvestmentTransactions(
  db: ScopedDb,
  api: PlaidApi,
  accessToken: string,
  accountIds: Map<string, string>,
  securityIds: Map<string, string>,
  now: Date,
) {
  if (accountIds.size === 0) return;
  const seen = await db.investmentTransactions.count({
    where: { accountId: { in: [...accountIds.values()] } },
  });
  const end = now.toISOString().slice(0, 10);
  const start = new Date(
    now.getTime() - (seen > 0 ? INVESTMENT_RESYNC_DAYS : INVESTMENT_HISTORY_DAYS) * 86_400_000,
  )
    .toISOString()
    .slice(0, 10);
  const rows: InvestmentTransaction[] = [];
  try {
    for (let offset = 0; ;) {
      const page = await plaidCall(
        api.investmentsTransactionsGet({
          access_token: accessToken,
          start_date: start,
          end_date: end,
          options: { count: INVESTMENT_TRANSACTIONS_PAGE, offset },
        }),
      );
      rows.push(...page.investment_transactions);
      offset += page.investment_transactions.length;
      if (page.investment_transactions.length === 0 || offset >= page.total_investment_transactions)
        break;
    }
  } catch (error) {
    const code = plaidErrorCode(error);
    if (!code) throw error;
    console.warn("Plaid investment transactions unavailable", { code });
    return;
  }
  const data = rows.flatMap((row) => {
    const t = normalizeInvestmentTransaction(row);
    const accountId = t && accountIds.get(t.accountRef);
    if (!t || !accountId) return [];
    return [
      {
        plaidInvestmentTransactionId: t.ref,
        accountId,
        securityId: t.securityRef ? (securityIds.get(t.securityRef) ?? null) : null,
        date: new Date(`${t.date}T00:00:00Z`),
        name: t.name,
        quantity: t.quantity,
        amountCents: t.amountCents,
        priceCents: t.priceCents,
        feesCents: t.feesCents,
        type: t.type,
        subtype: t.subtype,
      },
    ];
  });
  // New ones in one go (two years of them on the first sync); ones already saved are
  // updated, since Plaid can correct them.
  const saved = new Set(
    (
      await db.investmentTransactions.findMany({
        where: {
          plaidInvestmentTransactionId: { in: data.map((d) => d.plaidInvestmentTransactionId) },
        },
        select: { plaidInvestmentTransactionId: true },
      })
    ).map((t) => t.plaidInvestmentTransactionId),
  );
  await db.investmentTransactions.createMany({
    data: data
      .filter((d) => !saved.has(d.plaidInvestmentTransactionId))
      .map((d) => ({ userId: db.userId, ...d })),
    skipDuplicates: true,
  });
  for (const { plaidInvestmentTransactionId, ...rest } of data) {
    if (!saved.has(plaidInvestmentTransactionId)) continue;
    await db.investmentTransactions.updateMany({
      where: { plaidInvestmentTransactionId },
      data: rest,
    });
  }
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
    // And its sample insurance policy (spec step 102).
    await ensureDemoPolicies(item.userId, { client, now });
  }

  const sync = await new PlaidDataSource(api, accessToken, item.transactionsCursor).load();
  const accountIds = await saveAccounts(db, item.id, sync);
  const counts = await saveTransactions(db, accountIds, sync);
  const recurring = await saveRecurringStreams(db, api, accessToken, accountIds);
  const liabilities = item.liabilities
    ? await saveLiabilities(db, api, accessToken, item.id)
    : "off";
  const investments = item.investments
    ? await saveInvestments(db, api, accessToken, item.id, now)
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
  // Spec step 104: Jane reshops insurance that renews soon or went up, by herself. A
  // problem there never fails the sync; the daily run tries again.
  await reshopPerson(item.userId, { client, now }).catch((error) =>
    console.error("Insurance reshop failed", { userId: item.userId, error: String(error) }),
  );
  // Card text from Claude, as a job: retried later if it fails, without failing the sync.
  await runJob(await enqueueJob("explain_findings", { userId: item.userId }, { client }), {
    client,
  });
  // Jane says what's new in the chat (spec step 82); a problem there never fails the sync.
  await runJaneAgentSafely(item.userId, { client, now, trigger: "sync" });
  return result;
}
