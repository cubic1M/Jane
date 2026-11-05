import { ROBINHOOD_LIMITS, robinhoodOpen } from "@/config/robinhood";
import type { PrismaClient } from "@/generated/prisma/client";
import { track } from "@/lib/analytics";
import { logAudit, SYSTEM_ACTOR } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import { scopedFor, type ScopedDb } from "@/lib/db-scoped";
import { forgetPrimer } from "@/lib/jane-agent/primer-cache";
import { log } from "@/lib/log";
import { ownedByStaying, type OnlyPeople } from "@/lib/only-people";
import { systemDb } from "@/lib/system-db";
import { CONNECTION_STATUS } from "./connection";
import {
  openReader,
  RobinhoodReadError,
  RobinhoodSignedOutError,
  type RobinhoodReader,
} from "./mcp-client";
import { RobinhoodGrantGoneError, RobinhoodOAuthError, refreshTokens, type Tokens } from "./oauth";
import {
  type AccountHandle,
  type FilledOrder,
  parseAccounts,
  parseOrders,
  parsePortfolio,
  parsePositions,
  parseQuotes,
  type Portfolio,
  type Position,
  RobinhoodShapeError,
  symbolsWithoutPrice,
} from "./parse";
import {
  CASH_REF,
  openSecrets,
  orderRef,
  sealSecrets,
  securityRef,
  type RobinhoodSecrets,
} from "./secrets";

// Reads a person's accounts, balances, holdings and filled orders from Robinhood and saves them in
// the same tables Plaid's investments use, so /investments, the detectors and the tax figures all
// read them as they read any account. Nothing here calls Claude.
//
// Everything is read and checked before anything is saved: a failure anywhere changes nothing, and
// the person keeps the last good numbers with their date.

type Options = { client?: PrismaClient; now?: Date };

export type RefreshResult = "updated" | "off" | "busy" | "reconnect" | "failed" | "none";

const WHY = "Cron: finds every Robinhood connection due a refresh";
const HOUR_MS = 60 * 60 * 1000;

type Read = {
  account: AccountHandle;
  portfolio: Portfolio;
  positions: Position[];
  // Null when the orders couldn't be read: the holdings are still good.
  orders: FilledOrder[] | null;
};

async function readEverything(reader: RobinhoodReader, now: Date): Promise<Read[]> {
  const accounts = parseAccounts(await reader.read("get_accounts"));
  const read: Read[] = [];
  // One at a time: a person has few accounts, and this is someone else's server.
  for (const account of accounts) {
    const portfolio = parsePortfolio(await reader.read("get_portfolio", account.args()));
    const held = await reader.read("get_equity_positions", account.args());
    const unpriced = symbolsWithoutPrice(held, accounts);
    const quotes =
      unpriced.length === 0
        ? undefined
        : parseQuotes(
            await reader.read("get_equity_quotes", { symbols: unpriced.join(",") }),
            accounts,
          );
    const { positions, dropped } = parsePositions(held, accounts, quotes);
    if (dropped > 0) log.warn("Robinhood positions left out", { dropped });
    read.push({
      account,
      portfolio,
      positions,
      orders: await readOrders(reader, account, accounts, now),
    });
  }
  return read;
}

async function readOrders(
  reader: RobinhoodReader,
  account: AccountHandle,
  accounts: AccountHandle[],
  now: Date,
): Promise<FilledOrder[] | null> {
  try {
    const { orders, dropped } = parseOrders(
      await reader.read("get_equity_orders", account.args()),
      accounts,
      now,
    );
    if (dropped > 0) log.warn("Robinhood orders left out", { dropped });
    return orders;
  } catch (error) {
    if (error instanceof RobinhoodSignedOutError) throw error;
    log.warn("Robinhood orders unavailable", { code: failureCode(error) });
    return null;
  }
}

// A code of ours for the record, never text from the server.
function failureCode(error: unknown): string {
  if (error instanceof RobinhoodReadError || error instanceof RobinhoodOAuthError) {
    return error.code;
  }
  if (error instanceof RobinhoodShapeError) return `shape_${error.tool}`;
  return "unexpected";
}

async function saveSecurity(
  db: ScopedDb,
  ref: string,
  data: {
    name: string;
    ticker: string | null;
    type: string;
    isCashEquivalent: boolean;
    closePriceCents?: number;
    closePriceAsOf?: Date;
  },
): Promise<string> {
  const saved = await db.securities.upsert({
    where: { userId_plaidSecurityId: { userId: db.userId, plaidSecurityId: ref } },
    create: { userId: db.userId, plaidSecurityId: ref, ...data },
    update: data,
    select: { id: true },
  });
  return saved.id;
}

// What an account holds, replaced. Cash is a holding like Plaid's, with no ticker, which is what the
// invested-cash detector and the page read.
async function saveHoldings(db: ScopedDb, accountId: string, read: Read, today: Date) {
  const kept: string[] = [];
  const hold = async (
    securityId: string,
    data: {
      quantity: number;
      priceCents: number;
      valueCents: number;
      costBasisCents: number | null;
    },
  ) => {
    const fields = { ...data, priceAsOf: today };
    await db.holdings.upsert({
      where: { accountId_securityId: { accountId, securityId } },
      create: { userId: db.userId, accountId, securityId, ...fields },
      update: fields,
    });
    kept.push(securityId);
  };
  for (const p of read.positions) {
    const securityId = await saveSecurity(db, securityRef(p.symbol), {
      name: p.name,
      ticker: p.symbol,
      type: p.type,
      isCashEquivalent: false,
      closePriceCents: p.priceCents,
      closePriceAsOf: today,
    });
    await hold(securityId, {
      quantity: p.quantity,
      priceCents: p.priceCents,
      valueCents: p.valueCents,
      costBasisCents: p.costBasisCents,
    });
  }
  if (read.portfolio.cashCents !== null && read.portfolio.cashCents > 0) {
    const securityId = await saveSecurity(db, CASH_REF, {
      name: "Cash",
      ticker: null,
      type: "cash",
      isCashEquivalent: true,
    });
    await hold(securityId, {
      quantity: read.portfolio.cashCents / 100,
      priceCents: 100,
      valueCents: read.portfolio.cashCents,
      costBasisCents: null,
    });
  }
  await db.holdings.deleteMany({ where: { accountId, securityId: { notIn: kept } } });
}

// Filled orders, in Plaid's sign (money out is positive), which is how the tax figures read them.
async function saveOrders(
  db: ScopedDb,
  accountId: string,
  orders: FilledOrder[],
  accountKey: string,
) {
  if (orders.length === 0) return;
  const securityIds = new Map<string, string>();
  for (const symbol of new Set(orders.map((o) => o.symbol))) {
    const ref = securityRef(symbol);
    const known = await db.securities.findFirst({
      where: { plaidSecurityId: ref },
      select: { id: true },
    });
    securityIds.set(
      symbol,
      known?.id ??
        (await saveSecurity(db, ref, {
          name: symbol,
          ticker: symbol,
          type: "equity",
          isCashEquivalent: false,
        })),
    );
  }
  await db.investmentTransactions.createMany({
    skipDuplicates: true,
    data: orders.map((o) => {
      const buy = o.side === "buy";
      return {
        userId: db.userId,
        accountId,
        securityId: securityIds.get(o.symbol) ?? null,
        plaidInvestmentTransactionId: orderRef(accountKey, o.id),
        date: new Date(`${o.date}T00:00:00Z`),
        name: `${buy ? "Bought" : "Sold"} ${o.symbol}`,
        quantity: buy ? o.quantity : -o.quantity,
        amountCents: buy ? o.totalCents : -o.totalCents,
        priceCents: o.priceCents,
        feesCents: o.feesCents,
        type: o.side,
        subtype: o.side,
      };
    }),
  });
}

async function saveEverything(
  db: ScopedDb,
  connectionId: string,
  accountKey: string,
  reads: Read[],
  now: Date,
) {
  const today = new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  const refs: string[] = [];
  for (const read of reads) {
    const ref = read.account.ref(accountKey);
    refs.push(ref);
    const fields = {
      name: read.account.name,
      subtype: read.account.subtype,
      currentBalanceCents: read.portfolio.totalCents,
    };
    const account = await db.accounts.upsert({
      where: { plaidAccountId: ref },
      create: {
        userId: db.userId,
        source: "robinhood",
        robinhoodConnectionId: connectionId,
        plaidAccountId: ref,
        type: "investment",
        ...fields,
      },
      update: fields,
      select: { id: true },
    });
    await saveHoldings(db, account.id, read, today);
    if (read.orders) await saveOrders(db, account.id, read.orders, accountKey);
  }
  // An account Robinhood no longer lists is gone, with what it held.
  await db.accounts.deleteMany({
    where: { robinhoodConnectionId: connectionId, plaidAccountId: { notIn: refs } },
  });
}

const backoffUntil = (failures: number, now: Date) =>
  new Date(
    now.getTime() +
      Math.min(
        ROBINHOOD_LIMITS.backoffHours * 2 ** Math.min(failures - 1, 16),
        ROBINHOOD_LIMITS.backoffMostHours,
      ) *
        HOUR_MS,
  );

// Asks for new tokens, and saves them at once: a server that rotates refresh tokens has already
// retired the old one, so losing these would lose the connection.
async function renew(
  db: ScopedDb,
  connectionId: string,
  clientId: string,
  secrets: RobinhoodSecrets,
  now: Date,
): Promise<RobinhoodSecrets> {
  if (!secrets.refreshToken) throw new RobinhoodGrantGoneError();
  const tokens: Tokens = await refreshTokens(clientId, secrets.refreshToken, {
    now: now.getTime(),
  });
  const next: RobinhoodSecrets = {
    ...secrets,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken ?? secrets.refreshToken,
  };
  await db.robinhoodConnections.updateMany({
    where: { id: connectionId },
    data: { secretsEncrypted: sealSecrets(next), accessExpiresAt: tokens.expiresAt },
  });
  return next;
}

// Refreshes one person's connection. Only ever throws for a bug: every expected failure is recorded
// on the connection, and the person is shown it.
export async function refreshConnection(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<RefreshResult> {
  if (!robinhoodOpen()) return "off";
  const db = scopedFor(userId, client);
  const lockedBefore = new Date(now.getTime() - ROBINHOOD_LIMITS.lockMinutes * 60 * 1000);
  const { count } = await db.robinhoodConnections.updateMany({
    where: {
      status: CONNECTION_STATUS.active,
      OR: [{ syncingSince: null }, { syncingSince: { lt: lockedBefore } }],
    },
    data: { syncingSince: now },
  });
  if (count === 0) {
    return (await db.robinhoodConnections.count()) === 0 ? "none" : "busy";
  }
  const row = await db.robinhoodConnections.findFirstOrThrow({
    select: { id: true, secretsEncrypted: true, clientId: true, accessExpiresAt: true },
  });
  try {
    let secrets = openSecrets(row.secretsEncrypted);
    const signal = AbortSignal.timeout(ROBINHOOD_LIMITS.personBudgetMs);
    const expiring =
      !secrets.accessToken ||
      (row.accessExpiresAt !== null && row.accessExpiresAt.getTime() - now.getTime() < 60_000);
    if (expiring) secrets = await renew(db, row.id, row.clientId, secrets, now);
    const readWith = (accessToken: string) =>
      readEverything(openReader({ accessToken, signal }), now);
    let reads: Read[];
    try {
      reads = await readWith(secrets.accessToken ?? "");
    } catch (error) {
      if (!(error instanceof RobinhoodSignedOutError)) throw error;
      // The token may only have expired early, so try one new one before calling it gone.
      secrets = await renew(db, row.id, row.clientId, secrets, now);
      reads = await readWith(secrets.accessToken ?? "");
    }
    await saveEverything(db, row.id, secrets.accountKey, reads, now);
    await db.robinhoodConnections.updateMany({
      where: { id: row.id },
      data: {
        lastSyncedAt: now,
        lastErrorCode: null,
        lastErrorAt: null,
        failures: 0,
        nextTryAt: null,
        syncingSince: null,
      },
    });
    // The chat's copy of the numbers was worked out before these.
    forgetPrimer(userId);
    return "updated";
  } catch (error) {
    if (error instanceof RobinhoodSignedOutError || error instanceof RobinhoodGrantGoneError) {
      await needsReconnect(db, row.id, row.secretsEncrypted, userId, now);
      return "reconnect";
    }
    await recordFailure(db, row.id, userId, error, now);
    return "failed";
  }
}

// Robinhood no longer accepts it (revoked, or expired for good): the tokens are wiped, the numbers
// stay with their date, and the page asks them to connect again.
async function needsReconnect(
  db: ScopedDb,
  connectionId: string,
  sealed: string,
  userId: string,
  now: Date,
) {
  const fresh = await db.robinhoodConnections.findFirst({
    where: { id: connectionId },
    select: { secretsEncrypted: true },
  });
  const { accountKey } = openSecrets(fresh?.secretsEncrypted ?? sealed);
  await db.robinhoodConnections.updateMany({
    where: { id: connectionId },
    data: {
      status: CONNECTION_STATUS.reconnect,
      secretsEncrypted: sealSecrets({ accessToken: null, refreshToken: null, accountKey }),
      accessExpiresAt: null,
      lastErrorCode: "signed_out",
      lastErrorAt: now,
      nextTryAt: null,
      syncingSince: null,
    },
  });
  await logAudit(
    SYSTEM_ACTOR,
    "robinhood_reconnect_needed",
    { type: "robinhood_connection", id: connectionId },
    { user_id: userId },
  );
  await track(userId, "robinhood_reconnect_needed");
}

async function recordFailure(
  db: ScopedDb,
  connectionId: string,
  userId: string,
  error: unknown,
  now: Date,
) {
  const code = failureCode(error);
  const current = await db.robinhoodConnections.findFirst({
    where: { id: connectionId },
    select: { failures: true },
  });
  const failures = (current?.failures ?? 0) + 1;
  await db.robinhoodConnections.updateMany({
    where: { id: connectionId },
    data: {
      failures,
      nextTryAt: backoffUntil(failures, now),
      lastErrorCode: code,
      lastErrorAt: now,
      syncingSince: null,
    },
  });
  // The shape is field names only, what the first real connection needs to fix a wrong assumption.
  log.error("Robinhood refresh failed", {
    code,
    ...(error instanceof RobinhoodShapeError ? { shape: error.shape } : {}),
  });
  await logAudit(
    SYSTEM_ACTOR,
    "robinhood_refresh_failed",
    { type: "robinhood_connection", id: connectionId },
    { user_id: userId, code, failures },
  );
}

export type RefreshRun = {
  updated: number;
  failed: number;
  reconnect: number;
  deferred: number;
};

// Vercel Cron, daily (src/app/api/cron/plaid-sync/route.ts). Off, it reads nothing. Oldest first, up
// to a cap and a time budget; a connection that keeps failing waits longer each time.
export async function refreshAllRobinhood({
  client = defaultClient,
  now = new Date(),
  userIds,
}: Options & OnlyPeople = {}): Promise<RefreshRun | null> {
  if (!robinhoodOpen()) return null;
  const cutoff = new Date(now.getTime() - ROBINHOOD_LIMITS.staleHours * HOUR_MS);
  const due = await systemDb(WHY, client).robinhoodConnection.findMany({
    where: {
      ...ownedByStaying(userIds),
      status: CONNECTION_STATUS.active,
      AND: [
        { OR: [{ lastSyncedAt: null }, { lastSyncedAt: { lt: cutoff } }] },
        { OR: [{ nextTryAt: null }, { nextTryAt: { lte: now } }] },
      ],
    },
    select: { userId: true },
    orderBy: { lastSyncedAt: { sort: "asc", nulls: "first" } },
    take: ROBINHOOD_LIMITS.cronConnections,
  });
  const run: RefreshRun = { updated: 0, failed: 0, reconnect: 0, deferred: 0 };
  const started = Date.now();
  for (const { userId } of due) {
    if (Date.now() - started >= ROBINHOOD_LIMITS.cronBudgetMs) {
      run.deferred += 1;
      continue;
    }
    const result = await refreshConnection(userId, { client, now }).catch((error: unknown) => {
      log.error("Robinhood refresh broke", { kind: error instanceof Error ? error.name : "Error" });
      return "failed" as const;
    });
    if (result === "updated") run.updated += 1;
    else if (result === "failed") run.failed += 1;
    else if (result === "reconnect") run.reconnect += 1;
  }
  return run;
}
