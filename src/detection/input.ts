import { cache } from "react";
import { BANK_BALANCE_STALE_DAYS } from "@/config/detection/forecast";
import { LOOKBACK_MONTHS } from "@/config/detection";
import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { scopedFor, type ScopedDb } from "@/lib/db-scoped";
import { FILE_SOURCE, GIVEN_SOURCE } from "@/lib/import/balances";
import { cardProducts } from "@/lib/insurance/card-benefits";
import { isDemoItemId } from "@/lib/plaid/demo-ids";
import { cachedRead } from "@/lib/read-cache";
import { systemDb } from "@/lib/system-db";
import { todayOf } from "@/lib/today";
import { copiesToLeaveOut } from "@/planning/books";
import { namedByDirectory, withDirectory } from "./merchants";
import type { DetectionInput, DetectionTransaction } from "./types";
import { daysBetween, isoDate, monthsBefore } from "./units";

// What detection reads (spec step 3 on): the person's accounts, a year and more of settled
// transactions, recurring streams, cancelled subscriptions and the merchant directory. Here, not
// in ./engine.ts, so the pages and the chat that only read it don't pull in the whole pipeline.

// A finding about one merchant is keyed "merchant:<key>".
export const MERCHANT_KEY_PREFIX = "merchant:";

const TRANSACTION_SELECT = {
  id: true,
  accountId: true,
  plaidTransactionId: true,
  date: true,
  amountCents: true,
  description: true,
  merchantName: true,
  pfcPrimary: true,
  pfcDetailed: true,
  categorySource: true,
} as const;

export async function loadInput(
  db: ScopedDb,
  asOf: string,
  client: PrismaClient,
): Promise<DetectionInput> {
  const cutoff = monthsBefore(asOf, LOOKBACK_MONTHS);
  const [allAccounts, allTransactions, allStreams, cancelled, directory, first, balanceDays] =
    await Promise.all([
      db.accounts.findMany({
        select: {
          id: true,
          name: true,
          type: true,
          subtype: true,
          currentBalanceCents: true,
          itemId: true,
          mask: true,
          item: { select: { plaidItemId: true, lastSyncedAt: true } },
        },
        orderBy: { id: "asc" },
      }),
      db.transactions.findMany({
        where: {
          pending: false,
          date: { gt: new Date(`${cutoff}T00:00:00Z`), lte: new Date(`${asOf}T00:00:00Z`) },
        },
        select: TRANSACTION_SELECT,
        orderBy: [{ date: "asc" }, { id: "asc" }],
      }),
      db.recurringStreams.findMany({ orderBy: { id: "asc" } }),
      // Subscriptions our team finished cancelling, for charges that come after.
      db.actions.findMany({
        where: {
          type: "cancel_subscription",
          status: "done",
          completedAt: { not: null },
          decision: { finding: { type: "subscription_review" } },
        },
        select: { completedAt: true, decision: { select: { finding: { select: { key: true } } } } },
        orderBy: { completedAt: "asc" },
      }),
      // The merchant directory is shared, not user data, so it's read without scoping.
      systemDb("Merchants are shared reference data, no one's own", client).merchant.findMany({
        select: { key: true, name: true, aliases: true, category: true },
      }),
      // How far back the person's data goes, before the lookback window too.
      db.transactions.aggregate({ where: { pending: false }, _min: { date: true } }),
      // The day each uploaded account's balance is from: its statement's or the person's
      // (src/lib/import/balances.ts), so the forecast walks it forward to today.
      db.balanceSnapshots.groupBy({
        by: ["accountId"],
        where: { source: { in: [FILE_SOURCE, GIVEN_SOURCE] } },
        _max: { date: true },
      }),
    ]);
  const balanceOn = new Map(
    balanceDays.flatMap((b) => (b._max.date ? [[b.accountId, isoDate(b._max.date)]] : [])),
  );
  // A bank's balance is from its last sync. Days old (signed out, or the bank's down), it isn't
  // today's: "safe to spend" read it as if it were. A sync that's merely overnight is today's.
  for (const a of allAccounts) {
    const synced = a.item?.lastSyncedAt;
    if (
      synced &&
      !balanceOn.has(a.id) &&
      daysBetween(isoDate(synced), asOf) >= BANK_BALANCE_STALE_DAYS
    ) {
      balanceOn.set(a.id, isoDate(synced));
    }
  }

  // Books QA: an account linked twice (through two logins) counts once, its Plaid streams too (beta
  // accuracy: a bank linked again showed every bill and payday twice in the cash flow).
  const copies = copiesToLeaveOut(allAccounts);
  const accounts = allAccounts.filter((a) => !copies.has(a.id));
  const transactions = allTransactions.filter((t) => !copies.has(t.accountId));
  const streams = allStreams.filter((s) => !copies.has(s.accountId));

  // Company names and categories from the merchant directory (detection/merchants.ts).
  return withDirectory(
    {
      asOf,
      ...(first._min.date ? { historyFrom: isoDate(first._min.date) } : {}),
      accounts: accounts.map((a) => ({
        id: a.id,
        name: a.name,
        type: a.type,
        subtype: a.subtype,
        currentBalanceCents: a.currentBalanceCents,
        ...(balanceOn.has(a.id) ? { balanceAsOf: balanceOn.get(a.id)! } : {}),
      })),
      // Spec step 152: the cards that come with cover.
      cardProducts: cardProducts(
        accounts.map((a) => ({
          id: a.id,
          name: a.name,
          type: a.type,
          demo: !!a.item && isDemoItemId(a.item.plaidItemId),
        })),
      ),
      transactions: transactions.map((t) => ({ ...t, date: isoDate(t.date) })),
      recurringStreams: streams.map((s) => ({
        ...s,
        lastDate: s.lastDate ? isoDate(s.lastDate) : null,
        predictedNextDate: s.predictedNextDate ? isoDate(s.predictedNextDate) : null,
      })),
      cancelledMerchants: cancelled.flatMap((a) => {
        const key = a.decision.finding.key;
        return a.completedAt && key.startsWith(MERCHANT_KEY_PREFIX)
          ? [
              {
                merchantKey: key.slice(MERCHANT_KEY_PREFIX.length),
                cancelledOn: isoDate(a.completedAt),
              },
            ]
          : [];
      }),
    },
    directory,
  );
}

// The person's settled transactions from one day through another (YYYY-MM-DD, both included),
// read the way detection reads them (loadInput): an account linked twice counts once and names
// come from the merchant directory. The chat's search reads through it, so it finds what the
// cards and pages name (card-chat mismatch: the card said "Apple Store", the search had "Apple").
export async function loadTransactionsBetween(
  userId: string,
  { client = defaultClient, from, to }: { client?: PrismaClient; from: string; to: string },
): Promise<DetectionTransaction[]> {
  const db = scopedFor(userId, client);
  const [accounts, rows, directory] = await Promise.all([
    db.accounts.findMany({
      select: { id: true, name: true, type: true, subtype: true, mask: true, itemId: true },
      orderBy: { id: "asc" },
    }),
    db.transactions.findMany({
      where: {
        pending: false,
        date: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) },
      },
      select: TRANSACTION_SELECT,
      orderBy: [{ date: "desc" }, { id: "asc" }],
    }),
    systemDb("Merchants are shared reference data, no one's own", client).merchant.findMany({
      select: { key: true, name: true, aliases: true, category: true },
    }),
  ]);
  const copies = copiesToLeaveOut(accounts);
  return namedByDirectory(
    rows.filter((t) => !copies.has(t.accountId)).map((t) => ({ ...t, date: isoDate(t.date) })),
    directory,
  );
}

// The detection input for one person, for read-only features like upcoming charges.
export async function loadDetectionInput(
  userId: string,
  { client = defaultClient, now = new Date() }: { client?: PrismaClient; now?: Date } = {},
): Promise<DetectionInput> {
  // The person's own day (src/lib/today.ts): what's due today is due on their calendar.
  const asOf = await todayOf(userId, { client, now });
  if (client !== defaultClient)
    return {
      ...(await cachedRead(`detectionInput:${userId}:${asOf}`, client, () =>
        loadInput(scopedFor(userId, client), asOf, client),
      )),
    };
  // Each caller gets its own copy of the top level: some set subscriptionMerchantKeys on it.
  return { ...(await inputOnce(userId, asOf)) };
}

// Loaded once per server render and day (React's cache): a page's parts each ask for it.
const inputOnce = cache((userId: string, asOf: string) =>
  loadInput(scopedFor(userId, defaultClient), asOf, defaultClient),
);
