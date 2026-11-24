import {
  BOOKS_DEBT_TYPES,
  BOOKS_IMPORT_STALE_DAYS,
  BOOKS_RECONCILED_TYPES,
  BOOKS_STALE_DAYS,
  BOOKS_TOLERANCE_CENTS,
  TRANSFER_IN,
  TRANSFER_MATCH_DAYS,
  PAID_TO_A_PERSON,
  TRANSFER_OUT,
  TRANSFER_TO_LINKED,
  UNMATCHED_TRANSFER_MIN_CENTS,
} from "@/config/books";
import { addDays } from "@/lib/dates";

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
    const between = (from: string, to: string) =>
      txns.filter((t) => t.date > from && t.date <= to).reduce((s, t) => s + t.amountCents, 0);
    const sum = between(a.date, b.date);
    const actual = b.balanceCents - a.balanceCents;
    const expected = sign * sum;
    const off = actual - expected;
    // A balance read on a day may only have that day's charges the next day (real-user QA): it
    // also adds up if each snapshot holds the transactions through the day before.
    const lagged = actual - sign * between(addDays(a.date, -1), addDays(b.date, -1));
    if (Math.abs(off) > BOOKS_TOLERANCE_CENTS && Math.abs(lagged) > BOOKS_TOLERANCE_CENTS) {
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
// at different bank links. A linked account is the one kept over an uploaded statement of it,
// whichever came first: the link updates each day, the statement stopped on its last day. Kept by
// age instead, an upload made before linking won, and net worth was the statement's old balance,
// with the live one left out (the founder's Home, 11-23: "not my current net worth").
export function duplicateAccounts(accounts: Acct[]): { keep: Acct; duplicate: Acct }[] {
  const out: { keep: Acct; duplicate: Acct }[] = [];
  const seen = new Map<string, Acct>();
  const uploaded = (a: Acct) => (a.itemId === null ? 1 : 0);
  for (const a of [...accounts].sort(
    (x, y) => uploaded(x) - uploaded(y) || x.id.localeCompare(y.id),
  )) {
    if (!a.mask) continue;
    const key = `${a.mask}|${a.type}|${a.subtype ?? ""}`;
    const first = seen.get(key);
    if (first && first.itemId !== a.itemId) out.push({ keep: first, duplicate: a });
    else if (!first) seen.set(key, a);
  }
  return out;
}

// Accounts the copy rule above can't tell apart but that could be one account counted twice: the
// same type at the same bank, where an upload has no last four digits, two links have none, or the
// last four agree and Plaid names the subtype differently. Both are counted, as today; the person
// is told (the founder's Home read about twice the truth, 11-23). Never two accounts whose last
// fours differ, nor an account with another subtype of the same bank (checking and savings), nor
// two accounts of one link. `bankOf` is the bank's name, or null for an upload, which then goes by
// its own name ("Chase checking" is Chase's). Pure.
export function maybeSameAccounts(
  accounts: readonly Acct[],
  bankOf: (a: Acct) => string | null,
): { a: Acct; b: Acct }[] {
  const plain = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, "");
  const sameBank = (a: Acct, b: Acct) => {
    const [x, y] = [bankOf(a), bankOf(b)];
    if (x && y) return plain(x) === plain(y);
    if (x || y) return plain((x ? b : a).name).includes(plain((x ?? y)!));
    const [m, n] = [plain(a.name), plain(b.name)];
    return m.length >= 4 && n.length >= 4 && (m.includes(n) || n.includes(m));
  };
  // Plaid names one kind of account in more than one way ("checking", "cash management"); a
  // checking and a savings account at one bank are two accounts, whatever their last fours.
  const family = (subtype: string | null) =>
    subtype === "cash management" || subtype === "prepaid"
      ? "checking"
      : subtype === "money market"
        ? "savings"
        : subtype;
  const kindsAgree = (a: Acct, b: Acct) =>
    !a.subtype || !b.subtype || family(a.subtype) === family(b.subtype);
  const out: { a: Acct; b: Acct }[] = [];
  const list = [...accounts].sort((x, y) => x.id.localeCompare(y.id));
  list.forEach((a, i) => {
    for (const b of list.slice(i + 1)) {
      if (a.type !== b.type || (a.itemId !== null && a.itemId === b.itemId)) continue;
      const masked = a.mask && b.mask;
      if (
        masked
          ? a.mask !== b.mask || a.subtype === b.subtype || !kindsAgree(a, b)
          : a.subtype !== b.subtype
      )
        continue;
      if (sameBank(a, b)) out.push({ a, b });
    }
  });
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
    if (toLinked(t) || PAID_TO_A_PERSON.test(t.description)) continue;
    const payee = t.description.trim().toLowerCase();
    const seen = latest.get(payee);
    if (!seen || t.date > seen.date) latest.set(payee, t);
  }
  return [...latest.values()].sort(
    (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id),
  );
}

// Imported (CSV) accounts whose data ends long enough ago to say so: their newest transaction is
// BOOKS_IMPORT_STALE_DAYS old or more, and nothing's been uploaded to them for as long. Right after
// an upload it isn't said: a bank's export always ends a few days back, and the person just gave
// what they had (round 15 of the new-user passes: the first thing after a first upload was "Some
// figures here rely on data I'm still checking… Import a newer one"). One with no transactions
// isn't said either (nothing was imported).
export function importsEnded(
  accounts: readonly {
    id: string;
    name: string;
    source: string;
    lastDate: string | null;
    // The day of its latest upload, when known.
    uploadedOn?: string | null;
  }[],
  asOf: string,
): { id: string; name: string; lastDate: string }[] {
  return accounts.flatMap((a) =>
    a.source === "csv" &&
    a.lastDate !== null &&
    daysBetween(a.lastDate, asOf) >= BOOKS_IMPORT_STALE_DAYS &&
    (!a.uploadedOn || daysBetween(a.uploadedOn, asOf) >= BOOKS_IMPORT_STALE_DAYS)
      ? [{ id: a.id, name: a.name, lastDate: a.lastDate }]
      : [],
  );
}
