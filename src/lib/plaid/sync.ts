import type { Holding, InvestmentTransaction, PlaidApi, TransactionStream } from "plaid";
import { scrub } from "@/lib/scrub";
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
import type { DemoOrder } from "@/data-sources/demo/demo-holdings";
import { SIMULATED_PARTNER } from "@/config/brokerage";
import { confirmSwitches, switchOf } from "@/lib/agent/switch";
import { ensureDemoOptions } from "@/lib/compare";
import { ensureDemoPolicies } from "@/lib/insurance/profile";
import { ensureDemoAssets } from "@/lib/plaid/demo-assets";
import { insuranceAfterSync } from "@/lib/insurance/daily";
import { demoPayoffs } from "@/lib/loan-applications";
import { confirmInsuranceSwitches } from "@/lib/insurance/switch";
import { demoExtrasOf, demoPlaidApi, isDemoToken } from "./demo";
import { postScanningHello } from "@/lib/jane-agent/open";
import { runJaneAgentSafely } from "@/lib/jane-agent/run";
import { scanSuggestions } from "@/lib/suggestions";
import { markScanDone } from "@/lib/scan";
import { phaseTimer } from "@/lib/trial-timing";

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

type Options = {
  client?: PrismaClient;
  api?: PlaidApi;
  now?: Date;
  // The first scan of a bank someone is waiting on (a link, the sample person): Jane's
  // findings are posted right after detection, before the slower sector work, and again
  // after it. Other syncs run Jane once, at the end.
  progressive?: boolean;
};

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
      hasPmi: l.hasPmi,
      escrowBalanceCents: l.escrowBalanceCents,
      hasPrepaymentPenalty: l.hasPrepaymentPenalty,
      lastStatementIssueDate: day(l.lastStatementIssueDate),
      lastStatementBalanceCents: l.lastStatementBalanceCents,
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

// Simulated orders the person placed through the stand-in brokerage (spec step 133), for
// the demo bank to replay into its holdings.
export async function demoOrders(db: ScopedDb): Promise<DemoOrder[]> {
  const orders = await db.brokerageOrders.findMany({
    where: { partner: SIMULATED_PARTNER, status: "filled" },
    select: {
      id: true,
      ticker: true,
      side: true,
      quantity: true,
      amountCents: true,
      filledAt: true,
      account: { select: { plaidAccountId: true } },
    },
    orderBy: [{ filledAt: "asc" }, { id: "asc" }],
  });
  return orders.flatMap((o) =>
    o.account.plaidAccountId &&
    o.filledAt &&
    (o.side === "buy" || o.side === "sell" || o.side === "deposit")
      ? [
          {
            id: o.id,
            accountRef: o.account.plaidAccountId,
            ticker: o.ticker,
            side: o.side,
            quantity: o.quantity,
            amountCents: o.amountCents,
            day: o.filledAt.toISOString().slice(0, 10),
          },
        ]
      : [],
  );
}

// Just the investment side of a demo item, right after the person placed simulated orders
// (spec step 133), so the holdings show them without a whole sync.
export async function syncDemoInvestments(
  itemId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<void> {
  const item = await client.plaidItem.findUnique({
    where: { id: itemId },
    select: { id: true, userId: true, accessTokenEncrypted: true, demoExtras: true },
  });
  if (!item) return;
  const accessToken = decrypt(item.accessTokenEncrypted);
  if (!isDemoToken(accessToken)) return;
  const db = scopedFor(item.userId, client);
  const api = demoPlaidApi(
    accessToken,
    now,
    [],
    await demoOrders(db),
    [],
    demoExtrasOf(item.demoExtras),
  );
  await saveInvestments(db, api, accessToken, item.id, now);
}

export async function syncItem(
  itemId: string,
  { client = defaultClient, api = plaid(), now = new Date(), progressive = false }: Options = {},
): Promise<SyncResult> {
  // The first scan's phases, logged once as trial_timing (where the first minute goes).
  const timing = phaseTimer("first_sync");
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
      demoExtras: true,
    },
  });
  if (!item) throw new Error("Plaid item not found");
  const db = scopedFor(item.userId, client);
  const accessToken = decrypt(item.accessTokenEncrypted);
  timing.mark("item");
  // The demo bank (spec step 75) answers in Plaid's place; everything after is the same.
  if (isDemoToken(accessToken)) {
    api = demoPlaidApi(
      accessToken,
      now,
      await demoSwitches(db),
      await demoOrders(db),
      // Spec step 112: loans a refinance paid off.
      await demoPayoffs(item.userId, { client }),
      // Spec step 159: extra stand-in accounts the person linked.
      demoExtrasOf(item.demoExtras),
    );
    // Its example options to compare against (spec step 76), and its sample insurance policy
    // (spec step 102): independent, so together.
    await Promise.all([
      ensureDemoOptions({ client, now }),
      ensureDemoPolicies(item.userId, { client, now }),
    ]);
  }

  // The first scan: "still going through your accounts" comes first, before anything Jane finds,
  // whenever the person gets to the chat.
  if (progressive && item.transactionsCursor === null) {
    // A millisecond before this sync's own time: everything Jane posts later in the sync is
    // stamped from `now` onward, so the hello is strictly first, never tied with the brief.
    await postScanningHello(item.userId, { client, now: new Date(now.getTime() - 1) }).catch(
      (error) => console.error("Posting the scanning hello failed", { error: String(error) }),
    );
  }
  timing.mark("demo_setup");
  const sync = await new PlaidDataSource(api, accessToken, item.transactionsCursor).load();
  timing.mark("load");
  const accountIds = await saveAccounts(db, item.id, sync);
  timing.mark("save_accounts");
  // The demo bank's home and car, once its loans are saved (spec step 67).
  if (isDemoToken(accessToken)) await ensureDemoAssets(item.userId, item.id, { client, now });
  timing.mark("assets");
  const counts = await saveTransactions(db, accountIds, sync);
  // From here the chat can open (accounts and transactions are in).
  timing.mark("save_transactions");
  const recurring = await saveRecurringStreams(db, api, accessToken, accountIds);
  timing.mark("recurring");
  const liabilities = item.liabilities
    ? await saveLiabilities(db, api, accessToken, item.id)
    : "off";
  timing.mark("liabilities");
  const investments = item.investments
    ? await saveInvestments(db, api, accessToken, item.id, now)
    : "off";
  timing.mark("investments");

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

  timing.mark("cursor_and_track");
  await runDetection(item.userId, { client, now });
  // Someone watching their first scan is looking at the chat: Jane's first words come at once,
  // whatever the hour (quiet hours had left a person scanned at night with no brief at all).
  const scanTrigger = progressive && result.firstSync ? "open" : "sync";
  timing.mark("detection");
  // The first scan after linking: what people see first (the findings) is posted right after
  // detection, before the slower sector work below; the chat is already open and fills in.
  if (progressive && result.firstSync) {
    // Jane's first words lead with what the detectors found for this person (spec step 265), so
    // those are worked out first, right after detection and before the slow sector work. Never
    // the old, generic brief for someone whose first scan is running. A problem here falls
    // back to the findings alone.
    await scanSuggestions(item.userId, { client, now }).catch((error) =>
      console.error("The first scan's suggestions failed", { error: String(error) }),
    );
    timing.mark("suggestions");
    await runJaneAgentSafely(item.userId, { client, now, trigger: scanTrigger, early: true });
    timing.mark("first_brief");
    // The brief is in the chat: the scan is over for the person (the page stops reloading
    // itself); the sectors' work and Jane's last words still follow and show on the next look.
    await markScanDone(item.userId, { client, now }).catch((error) =>
      console.error("Marking the scan done failed", { error: String(error) }),
    );
  }
  // After detection these don't depend on each other, so they run together; the sample
  // person's first screen is waiting on this sync.
  // None of it may stop the rest: a failure in one sector's work (a slow database, a partner
  // that errors) used to end the sync here, so Jane's last words and the end of the scan never
  // came and a new person's chat said "still going through your accounts" for good.
  const sectors = await Promise.allSettled([
    // New charges may show that a switch went through (spec step 77).
    confirmSwitches({ client, now, userId: item.userId }),
    // Spec step 105: an insurance switch whose first payment went through.
    confirmInsuranceSwitches({ client, now, userId: item.userId }),
    // Spec step 104: Jane reshops insurance that renews soon or went up, by herself. A
    // problem there never fails the sync; the daily run tries again.
    // Spec step 106: and checks the cover once a year and after a life event.
    insuranceAfterSync(item.userId, { client, now }),
    // Card text from Claude, as a job: retried later if it fails, without failing the sync.
    (async () =>
      runJob(await enqueueJob("explain_findings", { userId: item.userId }, { client }), {
        client,
      }))(),
  ]);
  for (const result of sectors) {
    if (result.status === "rejected") {
      console.error("A sector's work after the sync failed", {
        error: scrub(String(result.reason)),
      });
    }
  }
  timing.mark("sectors");
  // Jane says what's new in the chat (spec step 82); a problem there never fails the sync.
  await runJaneAgentSafely(item.userId, { client, now, trigger: scanTrigger });
  await markScanDone(item.userId, { client, now });
  timing.mark("last_run");
  // The person's numbers for Claude, saved now so the chat reads them in one query instead of
  // looking every sector up while someone waits. Loaded here, not at the top: that file
  // reaches this one again through the jobs.
  await import("@/lib/jane-agent/claude-tools")
    .then((m) => m.refreshPrimer(item.userId, { client, now }))
    .catch((error) =>
      console.error("Saving the numbers for Claude failed", { error: String(error) }),
    );
  timing.mark("primer");
  // Only the first scan of a person is the one being timed.
  if (progressive && result.firstSync) {
    timing.done({ added: result.added, accounts: result.accounts });
  }
  return result;
}
