import { BOOKS_KIND_LABELS, BOOKS_LOOKBACK_DAYS, BOOKS_WORRYING_KINDS } from "@/config/books";
import { HIDDEN_ITEM_STATUSES } from "@/config/plaid";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { logAudit } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import { scopedFor, personTransaction } from "@/lib/db-scoped";
import { formatCents } from "@/lib/money";
import {
  duplicateAccounts,
  importsEnded,
  linkProblems,
  matchTransfers,
  unmatchedToSay,
  provenSame,
  reconcile,
  type Tx,
} from "@/planning/books";
import { addDays, isoDay as iso } from "@/lib/dates";
import { dayLabel } from "@/lib/day-label";
import { accountCopies } from "@/lib/account-copies";

// Books that balance (spec step 238): every day Jane checks that balances agree with their
// transactions, finds the same account linked twice (and merges it, only when both copies are
// proven to match), notices a link that stopped or needs a sign-in, and matches transfers
// between the person's own accounts. What doesn't add up is kept as an issue until it clears,
// and the figures that rely on those accounts are marked.

type Options = { client?: PrismaClient; now?: Date };

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
    // The account came from uploaded files (or was added by hand): no bank link to check.
    uploaded: boolean;
  }[];
  // Accounts whose figures are marked until the problem is fixed.
  markedAccountIds: string[];
  merged: number;
};

// Merges a duplicate account into the one kept, after both sides are proven to match. The
// copy's transactions the kept one lacks (older ones) move across; matched ones are dropped;
// then the copy goes. Refuses an account that carries anything else (a loan's terms, holdings).
async function mergeDuplicate(
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
  await personTransaction(
    userId,
    async (tx) => {
      if (moveIds.size > 0) {
        await tx.transaction.updateMany({
          where: { id: { in: [...moveIds] }, userId },
          data: { accountId: keepId },
        });
      }
      await tx.account.deleteMany({ where: { id: duplicateId, userId } });
    },
    client,
  );
  await logAudit(
    { type: "user", id: userId },
    "books_merged",
    { type: "account", id: keepId },
    { moved: moveIds.size, matched: dupTx.length - moveIds.size },
  );
  void now;
  return true;
}

// The lines of an uploaded copy dated before its linked account's first line: what leaving the
// copy out stops counting (the link's own history starts when it was linked).
async function olderThanTheLink(
  db: ReturnType<typeof scopedFor>,
  linkId: string,
  uploadId: string,
) {
  const first = await db.transactions.findFirst({
    where: { accountId: linkId },
    orderBy: { date: "asc" },
    select: { date: true },
  });
  if (!first) return null;
  const older = await db.transactions.findMany({
    where: { accountId: uploadId, date: { lt: first.date } },
    orderBy: { date: "asc" },
    select: { date: true },
  });
  const [oldest] = older;
  const newest = older.at(-1);
  return oldest && newest
    ? { count: older.length, from: iso(oldest.date), to: iso(newest.date) }
    : null;
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
      select: {
        id: true,
        itemId: true,
        name: true,
        mask: true,
        type: true,
        subtype: true,
        source: true,
        currentBalanceCents: true,
      },
    }),
    db.plaidItems.findMany({
      where: { status: { notIn: [...HIDDEN_ITEM_STATUSES] } },
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
    // A statement uploaded of an account since linked is never merged away: merging deletes the
    // copy with its balances, and before the link was kept over the upload it deleted the link,
    // which the next sync made again. It's left out of the figures (src/lib/account-copies.ts).
    const upload = duplicate.itemId === null;
    if (!upload && (await mergeDuplicate(userId, keep.id, duplicate.id, { client, now }))) {
      merged += 1;
      accounts = accounts.filter((a) => a.id !== duplicate.id);
    } else {
      // What leaving the statement out loses: its lines from before the link's first one.
      const lost = upload ? await olderThanTheLink(db, keep.id, duplicate.id) : null;
      found.push({
        kind: "duplicate",
        key: `dup:${duplicate.id}`,
        accountId: duplicate.id,
        detail: { keep: keep.id },
        words: upload
          ? `${duplicate.name} (ending ${duplicate.mask}) is a statement you uploaded of ${keep.name}, which you've since linked. I count the linked one, which updates each day, and leave the statement out.${lost ? ` Its ${lost.count} ${lost.count === 1 ? "line" : "lines"} from ${dayLabel(lost.from, { year: true })} to ${dayLabel(lost.to, { year: true })}, before the link's first day, aren't counted anywhere.` : ""}`
          : `${duplicate.name} (ending ${duplicate.mask}) looks like the same account linked twice, through two bank logins, but I can't prove the two copies match transaction for transaction, so I haven't merged them.`,
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
  // A copy left out of the figures is in none of them, so nothing about it is checked or said to
  // be in doubt: not its balances, its file's end, or its transfers.
  const copies = await accountCopies(db);
  // An uploaded account with no balance (its only statement was taken back) has nothing to check.
  const checkable = (a: (typeof accounts)[number]) =>
    !copies.has(a.id) && !(a.source === "csv" && a.currentBalanceCents === null);
  for (const account of accounts.filter(checkable)) {
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
          ? `${account.name}'s balance changed by ${formatCents(Math.abs(mismatch.balanceChangeCents))} between ${dayLabel(mismatch.from)} and ${dayLabel(mismatch.to, { year: true })}, but the bank sent no transactions for it.`
          : `${account.name}'s balance doesn't match its transactions between ${dayLabel(mismatch.from)} and ${dayLabel(mismatch.to, { year: true })}: it's off by ${formatCents(Math.abs(mismatch.offByCents))}.`,
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
  // An imported account's data ends where its file did: said plainly, with a fresh import.
  // Not a copy left out of the figures (a statement kept beside its link): it can't be an old import.
  const imported = accounts.filter((a) => a.source === "csv" && !copies.has(a.id));
  const newest =
    imported.length === 0
      ? []
      : await db.transactions.findMany({
          where: { accountId: { in: imported.map((a) => a.id) } },
          distinct: ["accountId"],
          orderBy: [{ accountId: "asc" }, { date: "desc" }],
          select: { accountId: true, date: true },
        });
  const lastOf = new Map(newest.map((t) => [t.accountId, iso(t.date)]));
  // Each account's latest upload: right after one, its file ending a few days back isn't said.
  const uploads =
    imported.length === 0
      ? []
      : await db.importRuns.findMany({
          where: { kind: "upload", accountId: { in: imported.map((a) => a.id) } },
          distinct: ["accountId"],
          orderBy: [{ accountId: "asc" }, { createdAt: "desc" }],
          select: { accountId: true, createdAt: true },
        });
  const uploadedOf = new Map(uploads.map((u) => [u.accountId, iso(u.createdAt)]));
  for (const a of importsEnded(
    imported.map((a) => ({
      ...a,
      lastDate: lastOf.get(a.id) ?? null,
      uploadedOn: uploadedOf.get(a.id) ?? null,
    })),
    asOf,
  )) {
    found.push({
      kind: "stale",
      key: `import:${a.id}`,
      accountId: a.id,
      detail: { lastDate: a.lastDate },
      // Readable dates and fewer words (round-2 pass: "(3)'s data ends on 2026-10-12, the last
      // day in the file you imported, so I can't see anything after it…").
      words: `${a.name}'s file ends on ${a.lastDate ? dayLabel(a.lastDate, { year: true }) : "an earlier day"}. Import a newer one and I'll pick up from there.`,
    });
  }
  // A copy left out of the figures is left out of transfer matching too: its spare lines would
  // otherwise make a transfer with no other side.
  const unmatched = unmatchedToSay(
    matchTransfers(txns.filter((t) => !copies.has(t.accountId)).map(asTx)).unmatchedOut,
    accounts,
  ).slice(-3);
  for (const t of unmatched) {
    found.push({
      kind: "transfer",
      // One per payee: the same transfer every month is one thing to say.
      key: `transfer:${t.description.trim().toLowerCase()}`,
      accountId: t.accountId,
      detail: { amountCents: t.amountCents, date: t.date },
      words: `A transfer of ${formatCents(t.amountCents)} on ${dayLabel(t.date, { year: true })} ("${t.description}") left one of your accounts with no matching deposit in another. If it went to an account I can't see, that's fine; add that account to count it.`,
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

const WORRYING = new Set(BOOKS_WORRYING_KINDS);

export async function openBooks(
  userId: string,
  { client = defaultClient }: Options = {},
): Promise<BooksView> {
  const db = scopedFor(userId, client);
  const [rows, accounts] = await Promise.all([
    db.booksIssues.findMany({
      // "maybe_same" is no longer raised: what net worth leaves out is said under it, from the
      // counting itself (src/lib/account-copies.ts), never from a stored sentence that can go stale.
      where: { status: "open", kind: { not: "maybe_same" } },
      orderBy: [{ createdAt: "asc" }, { key: "asc" }],
      select: { id: true, kind: true, accountId: true, itemId: true, detail: true },
    }),
    db.accounts.findMany({ select: { id: true, itemId: true } }),
  ]);
  // A row can be older than the counting: its account was left out since, and the next check will
  // mark it fixed. Until then it isn't shown or marked, as that account is in no figure. The
  // duplicate line is about the left-out copy itself, so it stays.
  const ofAccount = rows.some((r) => r.accountId !== null && r.kind !== "duplicate");
  const copies = ofAccount ? await accountCopies(db) : new Set<string>();
  const shown = rows.filter((r) => r.kind === "duplicate" || !copies.has(r.accountId ?? ""));
  const marked = new Set<string>();
  for (const r of shown) {
    if (!WORRYING.has(r.kind)) continue;
    if (r.accountId) marked.add(r.accountId);
    if (r.itemId) for (const a of accounts) if (a.itemId === r.itemId) marked.add(a.id);
  }
  return {
    open: shown.map((r) => ({
      id: r.id,
      kind: r.kind,
      label: BOOKS_KIND_LABELS[r.kind] ?? r.kind,
      words: String((r.detail as { words?: unknown } | null)?.words ?? ""),
      accountId: r.accountId,
      itemId: r.itemId,
      uploaded: r.accountId !== null && accounts.find((a) => a.id === r.accountId)?.itemId === null,
    })),
    markedAccountIds: [...marked],
    merged: 0,
  };
}
