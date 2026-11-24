import {
  DEBT_ACCOUNT_TYPES,
  LOAN_SEEN_CATEGORIES,
  LOAN_SEEN_DAYS,
  NET_WORTH_MONTHS,
} from "@/config/net-worth";
import type { PrismaClient } from "@/generated/prisma/client";
import {
  maybeSameHref,
  maybeSameShort,
  maybeSameWords,
  netWorth,
  netWorthCovers,
  netWorthLine,
  type NetWorth,
  type Unbalanced,
} from "@/insights/net-worth";
import { lenderName } from "@/insights/paid-loans";
import { monthsEnding } from "@/insights/spending";
import { withoutCopies } from "@/lib/account-copies";
import { cryptoTotal } from "@/lib/crypto/crypto";
import { DAY_MS } from "@/lib/dates";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { todayOf } from "@/lib/today";
import { copiesToLeaveOut, maybeSameAccounts } from "@/planning/books";

// What net worth is worked out from, read one way for every surface that shows it (gate B: the
// weekly email left out what the person owns and their crypto, the month close and Home's line
// counted an account linked twice): each account once (src/lib/account-copies.ts), its balances
// since `since` (all of them without), what the person owns at their values, and crypto.
export async function loadNetWorthInputs(
  userId: string,
  { client = defaultClient, since }: { client?: PrismaClient; since?: string } = {},
) {
  const db = scopedFor(userId, client);
  const [allAccounts, allSnapshots, ownedRows, crypto] = await Promise.all([
    db.accounts.findMany({
      select: {
        id: true,
        name: true,
        type: true,
        subtype: true,
        currentBalanceCents: true,
        itemId: true,
        mask: true,
        createdAt: true,
      },
    }),
    db.balanceSnapshots.findMany({
      ...(since ? { where: { date: { gte: new Date(`${since}T00:00:00Z`) } } } : {}),
      select: { accountId: true, date: true, balanceCents: true },
    }),
    db.ownedAssets.findMany({
      select: { id: true, name: true, valueCents: true, valuedOn: true, loanAccountId: true },
    }),
    cryptoTotal(userId, { client }),
  ]);
  const copies = copiesToLeaveOut(allAccounts);
  const accounts = withoutCopies(allAccounts, copies, (a) => a.id);
  return {
    accounts,
    snapshots: withoutCopies(allSnapshots, copies, (s) => s.accountId).map((s) => ({
      ...s,
      date: s.date.toISOString().slice(0, 10),
    })),
    owned: ownedRows.map((o) => ({ ...o, valuedOn: o.valuedOn.toISOString().slice(0, 10) })),
    crypto,
    // Net worth today, the figure every surface shows.
    worth: netWorth(
      accounts.map((a) => ({ ...a, balanceCents: a.currentBalanceCents })),
      ownedRows.map((o) => ({
        id: o.id,
        valueCents: o.valueCents,
        valuedOn: o.valuedOn.toISOString().slice(0, 10),
      })),
      crypto,
    ),
  };
}

// Net worth today and at the end of each month before it, worked out one way for the home hub,
// /net-worth and the monthly report (src/insights/net-worth.ts, netWorthLine), so they never
// disagree: the monthly report once counted only accounts with a balance history, and showed a
// family $399,283.78 in the red while every other page said $165,468.50 (area plan walk).
export async function loadNetWorthHistory(
  userId: string,
  {
    client = defaultClient,
    now = new Date(),
    months = NET_WORTH_MONTHS,
  }: { client?: PrismaClient; now?: Date; months?: number } = {},
): Promise<{
  todayCents: number;
  months: { month: string; netCents: number | null }[];
  // False when nothing counted has a value: every account's balance is unknown (statements
  // without a balance column) and nothing owned is entered, so "$0" would be wrong.
  known: boolean;
  // The accounts it can't count yet for want of a balance, for notCounting's words.
  unbalanced: Unbalanced[];
  // Today's figure in parts (what's held, owed, invested, owned, crypto), for the chat and emails.
  worth: NetWorth;
} | null> {
  const asOf = await todayOf(userId, { client, now });
  const [first] = monthsEnding(asOf, months);
  const { accounts, snapshots, owned, worth } = await loadNetWorthInputs(userId, {
    client,
    since: `${first}-01`,
  });
  if (accounts.length === 0) return null;
  return {
    todayCents: worth.netCents,
    known: worth.known,
    unbalanced: worth.unbalanced,
    worth,
    months: netWorthLine(accounts, snapshots, owned, asOf, months, worth.netCents),
  };
}

// What net worth covers, in words, from the same accounts it counts (each once, with what the person
// owns and their crypto): said under the figure on Home.
export async function loadNetWorthCovers(
  userId: string,
  { client = defaultClient }: { client?: PrismaClient } = {},
): Promise<string | null> {
  const { accounts, owned, crypto } = await loadNetWorthInputs(userId, { client });
  return netWorthCovers(
    accounts.map((a) => ({ type: a.type, balanceCents: a.currentBalanceCents })),
    { owned: owned.length, crypto: crypto > 0 },
  );
}

// Accounts that may be one account counted twice, in words (src/insights/net-worth.ts), from the
// accounts net worth counts, and where one is removed; null when there are none. Said under the
// figure on Home and Money.
export async function loadMaybeSame(
  userId: string,
  { client = defaultClient }: { client?: PrismaClient } = {},
): Promise<{ words: string; short: string; href: string } | null> {
  const [{ accounts }, items] = await Promise.all([
    loadNetWorthInputs(userId, { client }),
    scopedFor(userId, client).plaidItems.findMany({ select: { id: true, institutionName: true } }),
  ]);
  const bank = new Map(items.map((i) => [i.id, i.institutionName]));
  // Only accounts whose balance is counted: net worth leaves out one with no balance, so it isn't
  // counted twice and there is nothing to say.
  const pairs = maybeSameAccounts(
    accounts.filter((a) => a.currentBalanceCents !== null),
    (a) => (a.itemId ? (bank.get(a.itemId) ?? null) : null),
  );
  const words = maybeSameWords(pairs);
  const short = maybeSameShort(pairs);
  return words && short ? { words, short, href: maybeSameHref(pairs) } : null;
}

// The accounts net worth can't count yet for want of a balance (src/insights/net-worth.ts
// notCounting says so beside the figure).
export async function accountsWithoutBalance(
  userId: string,
  { client = defaultClient }: { client?: PrismaClient } = {},
): Promise<Unbalanced[]> {
  const rows = await scopedFor(userId, client).accounts.findMany({
    where: { currentBalanceCents: null },
    select: { name: true, type: true },
    orderBy: { name: "asc" },
  });
  return rows.map((r) => ({ name: r.name, card: DEBT_ACCOUNT_TYPES.includes(r.type) }));
}

// Nothing but cards and loans on file (src/insights/net-worth.ts NO_BANK_SEEN).
export async function onlyDebtsSeen(
  userId: string,
  { client = defaultClient }: { client?: PrismaClient } = {},
): Promise<boolean> {
  const db = scopedFor(userId, client);
  const [accounts, owned, crypto] = await Promise.all([
    db.accounts.findMany({
      select: {
        id: true,
        name: true,
        type: true,
        currentBalanceCents: true,
        itemId: true,
        mask: true,
        subtype: true,
      },
    }),
    db.ownedAssets.findMany({
      select: { id: true, valueCents: true, valuedOn: true, loanAccountId: true },
    }),
    cryptoTotal(userId, { client }),
  ]);
  return netWorth(
    withoutCopies(accounts, copiesToLeaveOut(accounts), (a) => a.id).map((a) => ({
      ...a,
      balanceCents: a.currentBalanceCents,
    })),
    owned.map((o) => ({ ...o, valuedOn: o.valuedOn.toISOString().slice(0, 10) })),
    crypto,
  ).onlyDebts;
}

// The loans the person's recent payments show, when no loan account says what's owed on them.
export async function loansSeenWithoutBalance(
  userId: string,
  { client = defaultClient, now = new Date() }: { client?: PrismaClient; now?: Date } = {},
): Promise<string[]> {
  const db = scopedFor(userId, client);
  const known = await db.accounts.count({
    where: { type: "loan", NOT: { currentBalanceCents: null } },
  });
  if (known > 0) return [];
  const rows = await db.transactions.findMany({
    where: {
      pfcDetailed: { in: [...LOAN_SEEN_CATEGORIES] },
      amountCents: { gt: 0 },
      date: { gte: new Date(now.getTime() - LOAN_SEEN_DAYS * DAY_MS) },
    },
    select: { merchantName: true, description: true },
  });
  // Named as Loans names them, without the bank's words for the payment (debugger 11-19).
  return [...new Set(rows.map((r) => lenderName(r.merchantName ?? r.description)))].sort();
}
