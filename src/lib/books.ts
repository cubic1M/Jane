import { BOOKS_KIND_LABELS, BOOKS_LOOKBACK_DAYS } from "@/config/books";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { logAudit } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { formatCents } from "@/lib/money";
import {
  duplicateAccounts,
  linkProblems,
  matchTransfers,
  provenSame,
  reconcile,
  type Tx,
} from "@/planning/books";

// Books that balance (spec step 238): every day Jane checks that balances agree with their
// transactions, finds the same account linked twice (and merges it, only when both copies are
// proven to match), notices a link that stopped or needs a sign-in, and matches transfers
// between the person's own accounts. What doesn't add up is kept as an issue until it clears,
// and the figures that rely on those accounts are marked.

type Options = { client?: PrismaClient; now?: Date };

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const asTx = (t: {
  id: string;
  accountId: string;
  date: Date;
  amountCents: number;
  description: string;
  pfcPrimary: string | null;
}): Tx => ({ ...t, date: iso(t.date) });

type Found = {
  kind: string;
  key: string;
  accountId?: string;
  itemId?: string;
  detail: Record<string, unknown>;
  words: string;
};

export type BooksView = {
  open: {
    id: string;
    kind: string;
    label: string;
    words: string;
    accountId: string | null;
    itemId: string | null;
  }[];
  // Accounts whose figures are marked until the problem is fixed.
  markedAccountIds: string[];
  merged: number;
};

// Merges a duplicate account into the one kept, after both sides are proven to match. The
// copy's transactions the kept one lacks (older ones) move across; matched ones are dropped;
// then the copy goes. Refuses an account that carries anything else (a loan's terms, holdings).
export async function mergeDuplicate(
  userId: string,
  keepId: string,
  duplicateId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<boolean> {
  const db = scopedFor(userId, client);
  const [keepTx, dupTx, dup] = await Promise.all([
    db.transactions.findMany({
      where: { accountId: keepId },
      select: {
        id: true,
        accountId: true,
        date: true,
        amountCents: true,
        description: true,
        pfcPrimary: true,
      },
    }),
    db.transactions.findMany({
      where: { accountId: duplicateId },
      select: {
        id: true,
        accountId: true,
        date: true,
        amountCents: true,
        description: true,
        pfcPrimary: true,
      },
    }),
    db.accounts.findFirst({
      where: { id: duplicateId },
      select: {
        id: true,
        _count: { select: { holdings: true, ownedAssets: true, brokerageOrders: true } },
        liability: { select: { id: true } },
      },
    }),
  ]);
  if (
    !dup ||
    dup.liability ||
    dup._count.holdings ||
    dup._count.ownedAssets ||
    dup._count.brokerageOrders
  ) {
    return false;
  }
  const proof = provenSame(keepTx.map(asTx), dupTx.map(asTx));
  if (!proof.ok) return false;
  const moveIds = new Set(proof.extra.map((t) => t.id));
  await client.$transaction([
    ...(moveIds.size > 0
      ? [
          client.transaction.updateMany({
            where: { id: { in: [...moveIds] }, userId },
            data: { accountId: keepId },
          }),
        ]
      : []),
    client.account.deleteMany({ where: { id: duplicateId, userId } }),
  ]);
  await logAudit(
    { type: "user", id: userId },
    "books_merged",
    { type: "account", id: keepId },
    { moved: moveIds.size, matched: dupTx.length - moveIds.size },
  );
  void now;
  return true;
}

export async function runBooksCheck(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<BooksView> {
  const db = scopedFor(userId, client);
  const asOf = iso(now);
  const from = new Date(`${addDays(asOf, -BOOKS_LOOKBACK_DAYS)}T00:00:00Z`);
  let merged = 0;

  // Duplicate accounts first: a merged copy shouldn't also fail the balance check.
  const [loadedAccounts, items] = await Promise.all([
    db.accounts.findMany({
      select: { id: true, itemId: true, name: true, mask: true, type: true, subtype: true },
    }),
    db.plaidItems.findMany({
      select: {
        id: true,
        institutionName: true,
        status: true,
        lastSyncedAt: true,
        createdAt: true,
      },
    }),
  ]);
  let accounts = loadedAccounts;
  const found: Found[] = [];
  for (const { keep, duplicate } of duplicateAccounts(accounts)) {
    if (await mergeDuplicate(userId, keep.id, duplicate.id, { client, now })) {
      merged += 1;
      accounts = accounts.filter((a) => a.id !== duplicate.id);
    } else {
      found.push({
        kind: "duplicate",
        key: `dup:${duplicate.id}`,
        accountId: duplicate.id,
        detail: { keep: keep.id },
        words: `${duplicate.name} (ending ${duplicate.mask}) looks like the same account as another you linked, but the two don't match transaction for transaction, so I haven't merged them.`,
      });
    }
  }

  const [snaps, txns] = await Promise.all([
    db.balanceSnapshots.findMany({
      where: { date: { gte: from } },
      select: { accountId: true, date: true, balanceCents: true },
    }),
    db.transactions.findMany({
      where: { date: { gte: from }, pending: false },
      select: {
        id: true,
        accountId: true,
        date: true,
        amountCents: true,
        description: true,
        pfcPrimary: true,
      },
    }),
  ]);
  const txByAccount = new Map<string, Tx[]>();
  for (const t of txns.map(asTx))
    txByAccount.set(t.accountId, [...(txByAccount.get(t.accountId) ?? []), t]);
  for (const account of accounts) {
    const mine = snaps
      .filter((s) => s.accountId === account.id)
      .map((s) => ({ date: iso(s.date), balanceCents: s.balanceCents }));
    const mismatch = reconcile(account.type, mine, txByAccount.get(account.id) ?? []);
    if (!mismatch) continue;
    found.push({
      kind: mismatch.kind,
      key: `balance:${account.id}`,
      accountId: account.id,
      detail: { ...mismatch },
      words:
        mismatch.kind === "gap"
          ? `${account.name}'s balance changed by ${formatCents(Math.abs(mismatch.balanceChangeCents))} between ${mismatch.from} and ${mismatch.to}, but the bank sent no transactions for it.`
          : `${account.name}'s balance doesn't match its transactions between ${mismatch.from} and ${mismatch.to}: it's off by ${formatCents(Math.abs(mismatch.offByCents))}.`,
    });
  }

  const { broken, stale } = linkProblems(
    items.map((i) => ({
      id: i.id,
      name: i.institutionName ?? "A bank",
      status: i.status,
      lastSyncedAt: i.lastSyncedAt ? iso(i.lastSyncedAt) : null,
      createdAt: iso(i.createdAt),
    })),
    asOf,
  );
  for (const l of broken) {
    found.push({
      kind: "broken",
      key: `broken:${l.id}`,
      itemId: l.id,
      detail: {},
      words: `${l.name} needs you to sign in again before I can keep your accounts there up to date.`,
    });
  }
  for (const l of stale) {
    found.push({
      kind: "stale",
      key: `stale:${l.id}`,
      itemId: l.id,
      detail: { lastSyncedAt: l.lastSyncedAt },
      words: `${l.name} hasn't updated since ${l.lastSyncedAt ?? "it was linked"}, so what I show from there may be out of date.`,
    });
  }
  const unmatched = matchTransfers(txns.map(asTx)).unmatchedOut.slice(-3);
  for (const t of unmatched) {
    found.push({
      kind: "transfer",
      key: `transfer:${t.id}`,
      accountId: t.accountId,
      detail: { amountCents: t.amountCents, date: t.date },
      words: `A transfer of ${formatCents(t.amountCents)} on ${t.date} ("${t.description}") left one of your accounts with no matching deposit in another. If it went to an account I can't see, that's fine; link it to count it.`,
    });
  }

  // Keep them: new ones open, ones that came back reopen, ones that cleared are fixed.
  const existing = await db.booksIssues.findMany({ select: { id: true, key: true, status: true } });
  const have = new Map(existing.map((e) => [e.key, e]));
  for (const f of found) {
    const known = have.get(f.key);
    const data = {
      kind: f.kind,
      accountId: f.accountId ?? null,
      itemId: f.itemId ?? null,
      detail: { ...f.detail, words: f.words } as Prisma.InputJsonObject,
    };
    if (!known)
      await db.booksIssues.create({ data: { userId, key: f.key, ...data, createdAt: now } });
    else if (known.status === "fixed") {
      await db.booksIssues.updateMany({
        where: { id: known.id },
        data: { ...data, status: "open", fixedAt: null, createdAt: now },
      });
    } else await db.booksIssues.updateMany({ where: { id: known.id }, data });
  }
  const stillFound = new Set(found.map((f) => f.key));
  await db.booksIssues.updateMany({
    where: { status: "open", key: { notIn: [...stillFound] } },
    data: { status: "fixed", fixedAt: now },
  });
  return { ...(await openBooks(userId, { client })), merged };
}

const WORRYING = new Set(["off", "gap", "stale", "broken", "duplicate"]);

export async function openBooks(
  userId: string,
  { client = defaultClient }: Options = {},
): Promise<BooksView> {
  const db = scopedFor(userId, client);
  const [rows, accounts] = await Promise.all([
    db.booksIssues.findMany({
      where: { status: "open" },
      orderBy: [{ createdAt: "asc" }, { key: "asc" }],
      select: { id: true, kind: true, accountId: true, itemId: true, detail: true },
    }),
    db.accounts.findMany({ select: { id: true, itemId: true } }),
  ]);
  const marked = new Set<string>();
  for (const r of rows) {
    if (!WORRYING.has(r.kind)) continue;
    if (r.accountId) marked.add(r.accountId);
    if (r.itemId) for (const a of accounts) if (a.itemId === r.itemId) marked.add(a.id);
  }
  return {
    open: rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      label: BOOKS_KIND_LABELS[r.kind] ?? r.kind,
      words: String((r.detail as { words?: unknown } | null)?.words ?? ""),
      accountId: r.accountId,
      itemId: r.itemId,
    })),
    markedAccountIds: [...marked],
    merged: 0,
  };
}
