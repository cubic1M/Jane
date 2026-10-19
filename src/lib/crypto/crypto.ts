import { CRYPTO_FEE_DAYS, type CryptoConnectionKind } from "@/config/crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import {
  cryptoFees,
  cryptoSize,
  isStale,
  type CryptoFees,
  type CryptoSize,
} from "@/insights/crypto";
import { adviceMode } from "@/lib/advice-mode";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { loadInvestments } from "@/lib/investments/holdings";
import { demoAnchorFor } from "@/lib/plaid/demo";
import {
  DEMO_CRYPTO_PARTNER,
  DEMO_EXCHANGE_NAME,
  DEMO_WALLET_ADDRESS,
  DEMO_WALLET_NAME,
  demoCryptoSource,
  type CryptoSource,
} from "./source";

// Crypto, read-only (spec step 161), for its page, net worth, Jane's answers and tools.
// Balances come from each connection's crypto source and are stored with when they were
// read; there is deliberately nothing here, or anywhere, that trades crypto.

type Options = { client?: PrismaClient; now?: Date };

export class CryptoError extends Error {}

const DAY_MS = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

// The source behind a connection, or null when its partner isn't connected (only the demo
// source exists until a crypto data partner is).
async function sourceFor(
  userId: string,
  partner: string,
  client: PrismaClient,
): Promise<CryptoSource | null> {
  if (partner !== DEMO_CRYPTO_PARTNER) return null;
  const anchor = await demoAnchorFor(userId, { client });
  return anchor ? demoCryptoSource(anchor) : null;
}

// Reads every connection's balances (and an exchange's last year of fees) and stores them.
export async function syncCrypto(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<number> {
  const db = scopedFor(userId, client);
  const connections = await db.cryptoConnections.findMany({
    select: { id: true, kind: true, partner: true, address: true },
  });
  let synced = 0;
  for (const c of connections) {
    const source = await sourceFor(userId, c.partner, client);
    if (!source) continue;
    const ref = { kind: c.kind as CryptoConnectionKind, partner: c.partner, address: c.address };
    const today = iso(now);
    const [balances, trades] = await Promise.all([
      source.balances(ref, today),
      source.trades(ref, iso(new Date(now.getTime() - CRYPTO_FEE_DAYS * DAY_MS)), today),
    ]);
    for (const b of balances) {
      const data = {
        name: b.name,
        quantity: b.quantity,
        priceCents: b.priceCents,
        valueCents: b.valueCents,
        costBasisCents: b.costBasisCents,
        asOf: now,
      };
      await db.cryptoHoldings.upsert({
        where: { connectionId_asset: { connectionId: c.id, asset: b.asset } },
        create: { userId, connectionId: c.id, asset: b.asset, ...data },
        update: data,
      });
    }
    await db.cryptoHoldings.deleteMany({
      where: { connectionId: c.id, asset: { notIn: balances.map((b) => b.asset) } },
    });
    await db.cryptoConnections.updateMany({
      where: { id: c.id },
      data: {
        lastSyncedAt: now,
        feesCents: trades.reduce((s, t) => s + t.feeCents, 0),
        tradedCents: trades.reduce((s, t) => s + t.amountCents, 0),
      },
    });
    synced += 1;
  }
  return synced;
}

// The nightly run (the plaid-sync cron): everyone with a crypto connection.
export async function syncAllCrypto({ client = defaultClient, now = new Date() }: Options = {}) {
  const people = await client.cryptoConnection.findMany({
    select: { userId: true },
    distinct: ["userId"],
    take: 500,
  });
  let synced = 0;
  for (const { userId } of people) synced += await syncCrypto(userId, { client, now });
  return { people: people.length, synced };
}

// The demo exchange or the demo wallet, for demo-bank people.
export async function linkDemoCrypto(
  userId: string,
  kind: CryptoConnectionKind,
  { client = defaultClient, now = new Date() }: Options = {},
) {
  if (!(await demoAnchorFor(userId, { client })))
    throw new CryptoError("A demo crypto connection needs the demo bank.");
  const db = scopedFor(userId, client);
  const name = kind === "exchange" ? DEMO_EXCHANGE_NAME : DEMO_WALLET_NAME;
  const existing = await db.cryptoConnections.findFirst({ where: { name }, select: { id: true } });
  if (!existing) {
    const row = await db.cryptoConnections.create({
      data: {
        userId,
        kind,
        name,
        partner: DEMO_CRYPTO_PARTNER,
        address: kind === "wallet" ? DEMO_WALLET_ADDRESS : null,
      },
      select: { id: true },
    });
    await logAudit(
      { type: "user", id: userId },
      "crypto_connected",
      { type: "crypto_connection", id: row.id },
      { kind, demo: true, readOnly: true },
    );
    await track(userId, "crypto_connected", { kind, demo: true });
  }
  await syncCrypto(userId, { client, now });
}

export type CryptoView = {
  advice: boolean;
  demo: boolean;
  connections: {
    id: string;
    kind: CryptoConnectionKind;
    name: string;
    address: string | null;
    // Where the balances came from, in words, and when they were read.
    source: string;
    asOf: Date | null;
    stale: boolean;
    totalCents: number;
    fees: CryptoFees | null;
  }[];
  holdings: {
    id: string;
    connectionId: string;
    asset: string;
    name: string;
    quantity: number;
    priceCents: number;
    valueCents: number;
    costBasisCents: number | null;
    asOf: Date;
  }[];
  size: CryptoSize;
  // Every exchange's fees together.
  fees: CryptoFees | null;
};

export async function loadCrypto(
  userId: string,
  {
    client = defaultClient,
    now = new Date(),
    investedCents,
  }: Options & { investedCents?: number } = {},
): Promise<CryptoView> {
  const db = scopedFor(userId, client);
  const [advice, connections, holdings, anchor, invested] = await Promise.all([
    adviceMode(userId, { client }),
    db.cryptoConnections.findMany({ orderBy: { createdAt: "asc" } }),
    db.cryptoHoldings.findMany({ orderBy: { valueCents: "desc" } }),
    demoAnchorFor(userId, { client }),
    investedCents !== undefined
      ? Promise.resolve(investedCents)
      : loadInvestments(userId, { client, now }).then((i) => i.totalCents),
  ]);
  const exchanges = connections.filter((c) => c.kind === "exchange");
  const fees = exchanges.reduce((s, c) => s + c.feesCents, 0);
  const traded = exchanges.reduce((s, c) => s + c.tradedCents, 0);
  return {
    advice,
    demo: anchor !== null,
    connections: connections.map((c) => {
      const own = holdings.filter((h) => h.connectionId === c.id);
      return {
        id: c.id,
        kind: c.kind as CryptoConnectionKind,
        name: c.name,
        address: c.address,
        source:
          c.partner === DEMO_CRYPTO_PARTNER
            ? `${c.name} (demo, sample data), read-only`
            : `${c.name}, read-only`,
        asOf: c.lastSyncedAt,
        stale: c.lastSyncedAt === null || isStale(c.lastSyncedAt, now),
        totalCents: own.reduce((s, h) => s + h.valueCents, 0),
        fees: c.kind === "exchange" ? cryptoFees(c.feesCents, c.tradedCents) : null,
      };
    }),
    holdings,
    size: cryptoSize(holdings, invested),
    fees: exchanges.length > 0 ? cryptoFees(fees, traded) : null,
  };
}

// Net worth's crypto: what every connection holds, as last read.
export async function cryptoTotal(
  userId: string,
  { client = defaultClient }: { client?: PrismaClient } = {},
): Promise<number> {
  const sum = await scopedFor(userId, client).cryptoHoldings.aggregate({
    _sum: { valueCents: true },
  });
  return sum._sum.valueCents ?? 0;
}
