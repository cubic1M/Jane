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
  shapeOf,
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
import { todayFor } from "@/lib/today";

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
  // A row was left out, so what isn't in this answer may still be held.
  partial: boolean;
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
    // Every row left out isn't someone who sold everything: it fails, and the numbers stay.
    if (positions.length === 0 && dropped > 0) {
      throw new RobinhoodShapeError("get_equity_positions", shapeOf(held));
    }
    if (dropped > 0) log.warn("Robinhood positions left out", { dropped });
    read.push({
      account,
      portfolio,
      positions,
      orders: await readOrders(reader, account, accounts, now),
      partial: dropped > 0,
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
    const { orders, dropped, pastLimit } = parseOrders(
      await reader.read("get_equity_orders", account.args()),
      accounts,
      now,
    );
    if (dropped > 0) log.warn("Robinhood orders left out", { dropped });
    // A history cut at the cap would date a sold lot wrongly (an earlier buy past the cap): the
    // orders count as unavailable and the earlier ones stay.
    if (pastLimit > 0) return null;
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

// The tables a refresh writes, inside the one transaction that saves it.
type Saving = Pick<
  Parameters<Parameters<ScopedDb["transaction"]>[0]>[0],
  "accounts" | "securities" | "holdings" | "investmentTransactions"
> & { userId: string };

async function saveSecurity(
  db: Saving,
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
async function saveHoldings(db: Saving, accountId: string, read: Read, today: Date) {
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
  // A valid answer that leaves the cash balance out says nothing about cash: what was saved stays
  // (only an explicit zero removes it).
  if (read.portfolio.cashCents === null) {
    const cash = await db.securities.findFirst({
      where: { plaidSecurityId: CASH_REF },
      select: { id: true },
    });
    if (cash) kept.push(cash.id);
  }
  if (!read.partial) {
    await db.holdings.deleteMany({ where: { accountId, securityId: { notIn: kept } } });
  }
}

// Filled orders, in Plaid's sign (money out is positive), which is how the tax figures read them.
async function saveOrders(
  db: Saving,
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
  db: Saving,
  connectionId: string,
  accountKey: string,
  reads: Read[],
  today: Date,
) {
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

// The connection while this refresh still holds it: the lock is the time it started. A new sign-in
// releases it, and from then nothing an older refresh read or was told is written.
const held = (connectionId: string, lockedAt: Date) => ({
  id: connectionId,
  syncingSince: lockedAt,
});

// A connection's credentials as one refresh knows them: opened, and as stored.
type Credentials = { sealed: string; secrets: RobinhoodSecrets };

// Asks for new tokens, and saves them at once: a server that rotates refresh tokens has already
// retired the old one, so losing these would lose the connection. They're saved while this refresh
// holds the connection, or while what's stored is still what it renewed (a sign-in that landed
// before it was read). A newer sign-in's tokens are never written over.
async function renew(
  db: ScopedDb,
  connectionId: string,
  clientId: string,
  { sealed, secrets }: Credentials,
  now: Date,
): Promise<Credentials> {
  if (!secrets.refreshToken) throw new RobinhoodGrantGoneError();
  const tokens: Tokens = await refreshTokens(clientId, secrets.refreshToken, {
    now: now.getTime(),
  });
  const next: RobinhoodSecrets = {
    ...secrets,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken ?? secrets.refreshToken,
  };
  const saved = sealSecrets(next);
  // Written again if the write fails, without asking Robinhood twice: the old refresh token is
  // already retired, so these are the only copy of the new ones.
  for (let attempt = 1; ; attempt += 1) {
    try {
      await db.robinhoodConnections.updateMany({
        where: { id: connectionId, OR: [{ syncingSince: now }, { secretsEncrypted: sealed }] },
        data: { secretsEncrypted: saved, accessExpiresAt: tokens.expiresAt },
      });
      break;
    } catch (error) {
      if (attempt >= TOKEN_SAVE_ATTEMPTS) throw error;
    }
  }
  return { sealed: saved, secrets: next };
}

const TOKEN_SAVE_ATTEMPTS = 3;

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
  // Read under the lease just taken: a sign-in that replaced the credentials and released the
  // lease in between leaves nothing here, and this refresh stops before it uses the new ones.
  const row = await db.robinhoodConnections.findFirst({
    where: { syncingSince: now },
    select: { id: true, secretsEncrypted: true, clientId: true, accessExpiresAt: true },
  });
  if (!row) return "busy";
  try {
    let credentials: Credentials = {
      sealed: row.secretsEncrypted,
      secrets: openSecrets(row.secretsEncrypted),
    };
    const signal = AbortSignal.timeout(ROBINHOOD_LIMITS.personBudgetMs);
    const expiring =
      !credentials.secrets.accessToken ||
      (row.accessExpiresAt !== null && row.accessExpiresAt.getTime() - now.getTime() < 60_000);
    if (expiring) credentials = await renew(db, row.id, row.clientId, credentials, now);
    const readWith = (accessToken: string) =>
      readEverything(openReader({ accessToken, signal }), now);
    let reads: Read[];
    try {
      reads = await readWith(credentials.secrets.accessToken ?? "");
    } catch (error) {
      if (!(error instanceof RobinhoodSignedOutError)) throw error;
      // The token may only have expired early, so try one new one before calling it gone.
      credentials = await renew(db, row.id, row.clientId, credentials, now);
      // Renewing worked, so the grant stands: a new token turned away is trouble at Robinhood, which
      // waits and tries again. Wiping the tokens would make them connect again for an outage.
      reads = await readWith(credentials.secrets.accessToken ?? "").catch((error: unknown) => {
        throw error instanceof RobinhoodSignedOutError
          ? new RobinhoodReadError("refused_after_renewal")
          : error;
      });
    }
    const today = new Date(`${await todayFor(db, now)}T00:00:00Z`);
    // One change. Writing the connection's row first locks it, so a new sign-in waits until all of
    // it is saved, and one that got there first leaves nothing to save.
    const saved = await db.transaction(async (tx) => {
      const { count } = await tx.robinhoodConnections.updateMany({
        where: held(row.id, now),
        data: {
          lastSyncedAt: now,
          lastErrorCode: null,
          lastErrorAt: null,
          failures: 0,
          nextTryAt: null,
          syncingSince: null,
        },
      });
      if (count === 0) return false;
      const saving = { ...tx, userId };
      await saveEverything(saving, row.id, credentials.secrets.accountKey, reads, today);
      return true;
    });
    if (!saved) return "busy";
    // The chat's copy of the numbers was worked out before these.
    forgetPrimer(userId);
    return "updated";
  } catch (error) {
    if (error instanceof RobinhoodSignedOutError || error instanceof RobinhoodGrantGoneError) {
      return (await needsReconnect(db, row.id, row.secretsEncrypted, userId, now))
        ? "reconnect"
        : "busy";
    }
    return (await recordFailure(db, row.id, userId, error, now)) ? "failed" : "busy";
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
  const { count } = await db.robinhoodConnections.updateMany({
    where: held(connectionId, now),
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
  if (count === 0) return false;
  await logAudit(
    SYSTEM_ACTOR,
    "robinhood_reconnect_needed",
    { type: "robinhood_connection", id: connectionId },
    { user_id: userId },
  );
  await track(userId, "robinhood_reconnect_needed");
  return true;
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
  const { count } = await db.robinhoodConnections.updateMany({
    where: held(connectionId, now),
    data: {
      failures,
      nextTryAt: backoffUntil(failures, now),
      lastErrorCode: code,
      lastErrorAt: now,
      syncingSince: null,
    },
  });
  if (count === 0) return false;
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
  return true;
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
  budgetMs = ROBINHOOD_LIMITS.cronBudgetMs,
}: Options & OnlyPeople & { budgetMs?: number } = {}): Promise<RefreshRun | null> {
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
    if (Date.now() - started >= budgetMs) {
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
