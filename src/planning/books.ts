import {
  BOOKS_DEBT_TYPES,
  BOOKS_IMPORT_STALE_DAYS,
  BOOKS_RECONCILED_TYPES,
  BOOKS_STALE_DAYS,
  BOOKS_TOLERANCE_CENTS,
  TRANSFER_IN,
  TRANSFER_MATCH_DAYS,
  TRANSFER_OUT,
  TRANSFER_TO_LINKED,
  UNMATCHED_TRANSFER_MIN_CENTS,
} from "@/config/books";

// Books that balance (spec step 238). Pure: a person's balances, transactions, accounts and
// bank links in, what doesn't add up out. Nothing here changes data; merging two copies of
// one account is only offered when every transaction on both sides is proven to match.

export type Snap = { date: string; balanceCents: number };
export type Tx = {
  id: string;
  accountId: string;
  date: string;
  amountCents: number;
  description: string;
  pfcPrimary: string | null;
};
export type Acct = {
  id: string;
  itemId: string | null;
  name: string;
  mask: string | null;
  type: string;
  subtype: string | null;
};
export type Link = {
  id: string;
  name: string;
  status: string;
  lastSyncedAt: string | null;
  createdAt: string;
};

const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) =>
  Math.abs(Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000));

export type Mismatch = {
  kind: "off" | "gap";
  from: string;
  to: string;
  balanceChangeCents: number;
  transactionsCents: number;
  offByCents: number;
};

// For each pair of snapshots: how the balance moved against what the transactions between
// them say it should have. Plaid amounts are positive for money out, which lowers an asset
// account's balance and raises what's owed on a card or loan. Returns the newest mismatch.
export function reconcile(accountType: string, snaps: Snap[], txns: Tx[]): Mismatch | null {
  if (!BOOKS_RECONCILED_TYPES.includes(accountType)) return null;
  const sorted = [...snaps].sort((a, b) => a.date.localeCompare(b.date));
  const sign = BOOKS_DEBT_TYPES.includes(accountType) ? 1 : -1;
  let found: Mismatch | null = null;
  for (let i = 1; i < sorted.length; i += 1) {
    const [a, b] = [sorted[i - 1], sorted[i]];
    const sum = txns
      .filter((t) => t.date > a.date && t.date <= b.date)
      .reduce((s, t) => s + t.amountCents, 0);
    const actual = b.balanceCents - a.balanceCents;
    const expected = sign * sum;
    const off = actual - expected;
    if (Math.abs(off) > BOOKS_TOLERANCE_CENTS) {
      found = {
        // The balance moved with no transactions at all: the bank stopped sending them.
        kind: sum === 0 ? "gap" : "off",
        from: a.date,
        to: b.date,
        balanceChangeCents: actual,
        transactionsCents: sum,
        offByCents: off,
      };
    }
  }
  return found;
}

// Accounts that look like the same one linked twice: the same last digits, type and subtype
// at different bank links.
export function duplicateAccounts(accounts: Acct[]): { keep: Acct; duplicate: Acct }[] {
  const out: { keep: Acct; duplicate: Acct }[] = [];
  const seen = new Map<string, Acct>();
  for (const a of [...accounts].sort((x, y) => x.id.localeCompare(y.id))) {
    if (!a.mask) continue;
    const key = `${a.mask}|${a.type}|${a.subtype ?? ""}`;
    const first = seen.get(key);
    if (first && first.itemId !== a.itemId) out.push({ keep: first, duplicate: a });
    else if (!first) seen.set(key, a);
  }
  return out;
}

// Books QA: the copies of an account linked twice, which the figures leave out so the account
// counts once (its balance and transactions not twice) until Jane merges it or the person
// removes the copy.
export const copiesToLeaveOut = (
  accounts: Pick<Acct, "id" | "itemId" | "mask" | "type" | "subtype">[],
): Set<string> =>
  new Set(duplicateAccounts(accounts.map((a) => ({ ...a, name: "" }))).map((d) => d.duplicate.id));

const same = (a: Tx, b: Tx) =>
  a.date === b.date &&
  a.amountCents === b.amountCents &&
  a.description.trim().toLowerCase() === b.description.trim().toLowerCase();

// Whether the duplicate's transactions are all on the account kept (the same date, amount and
// description), within the dates both have. Only then are the two sides proven to match; the
// duplicate's older or newer ones (outside the other's dates) are listed, to be moved.
export function provenSame(
  keep: Tx[],
  duplicate: Tx[],
): { ok: boolean; unmatched: Tx[]; extra: Tx[] } {
  if (keep.length === 0 || duplicate.length === 0)
    return { ok: false, unmatched: duplicate, extra: [] };
  const first = keep.reduce((m, t) => (t.date < m ? t.date : m), keep[0].date);
  const last = keep.reduce((m, t) => (t.date > m ? t.date : m), keep[0].date);
  const used = new Set<string>();
  const unmatched: Tx[] = [];
  const extra: Tx[] = [];
  for (const d of duplicate) {
    if (d.date < first || d.date > last) {
      extra.push(d);
      continue;
    }
    const twin = keep.find((k) => !used.has(k.id) && same(k, d));
    if (twin) used.add(twin.id);
    else unmatched.push(d);
  }
  // Every transaction the kept account has in the duplicate's own dates must be on the
  // duplicate too, or the two don't describe the same account.
  const dFirst = duplicate.reduce((m, t) => (t.date < m ? t.date : m), duplicate[0].date);
  const dLast = duplicate.reduce((m, t) => (t.date > m ? t.date : m), duplicate[0].date);
  const missingOnDuplicate = keep.filter(
    (k) => k.date >= dFirst && k.date <= dLast && !duplicate.some((d) => same(k, d)),
  );
  return { ok: unmatched.length === 0 && missingOnDuplicate.length === 0, unmatched, extra };
}

// Transfers between the person's own accounts, matched in pairs: money out of one account and
// the same amount in to another within TRANSFER_MATCH_DAYS. Returns the pairs and the
// transfers out (of any real size) with no other side.
export function matchTransfers(txns: Tx[]): {
  pairs: { out: Tx; in: Tx }[];
  unmatchedOut: Tx[];
} {
  const outs = txns.filter((t) => t.pfcPrimary === TRANSFER_OUT && t.amountCents > 0);
  const ins = txns.filter((t) => t.pfcPrimary === TRANSFER_IN && t.amountCents < 0);
  const used = new Set<string>();
  const pairs: { out: Tx; in: Tx }[] = [];
  const unmatchedOut: Tx[] = [];
  for (const out of outs.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))) {
    const twin = ins.find(
      (i) =>
        !used.has(i.id) &&
        i.accountId !== out.accountId &&
        -i.amountCents === out.amountCents &&
        daysBetween(i.date, out.date) <= TRANSFER_MATCH_DAYS,
    );
    if (twin) {
      used.add(twin.id);
      pairs.push({ out, in: twin });
    } else if (out.amountCents >= UNMATCHED_TRANSFER_MIN_CENTS) {
      unmatchedOut.push(out);
    }
  }
  return { pairs, unmatchedOut };
}

// Bank links that have stopped updating or need the person to sign in again.
export function linkProblems(links: Link[], asOf: string): { broken: Link[]; stale: Link[] } {
  const broken = links.filter((l) => l.status !== "active");
  const stale = links.filter(
    (l) =>
      l.status === "active" &&
      (l.lastSyncedAt ?? l.createdAt.slice(0, 10)) < addDays(asOf, -BOOKS_STALE_DAYS),
  );
  return { broken, stale };
}

// Transfers out with no other side, as the person should hear about them (books QA): one that
// names a kind of account they've linked went there (an HSA or IRA contribution arrives as an
// investment transaction, not a deposit), and the same payee month after month is one thing to
// say, by its latest transfer.
export function unmatchedToSay(unmatched: readonly Tx[], accounts: readonly Acct[]): Tx[] {
  const linked = new Set(accounts.map((a) => (a.subtype ?? "").toLowerCase()));
  const toLinked = (t: Tx) =>
    Object.entries(TRANSFER_TO_LINKED).some(
      ([word, subtypes]) =>
        new RegExp(`\\b${word}\\b`, "i").test(t.description) && subtypes.some((s) => linked.has(s)),
    );
  const latest = new Map<string, Tx>();
  for (const t of unmatched) {
    if (toLinked(t)) continue;
    const payee = t.description.trim().toLowerCase();
    const seen = latest.get(payee);
    if (!seen || t.date > seen.date) latest.set(payee, t);
  }
  return [...latest.values()].sort(
    (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id),
  );
}

// Imported (CSV) accounts whose data ends long enough ago to say so: their newest transaction is
// BOOKS_IMPORT_STALE_DAYS old or more. One with no transactions isn't said (nothing was imported).
export function importsEnded(
  accounts: readonly { id: string; name: string; source: string; lastDate: string | null }[],
  asOf: string,
): { id: string; name: string; lastDate: string }[] {
  return accounts.flatMap((a) =>
    a.source === "csv" &&
    a.lastDate !== null &&
    daysBetween(a.lastDate, asOf) >= BOOKS_IMPORT_STALE_DAYS
      ? [{ id: a.id, name: a.name, lastDate: a.lastDate }]
      : [],
  );
}
