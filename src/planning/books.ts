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
export function maybeSameAccounts<T extends Acct>(
  accounts: readonly T[],
  bankOf: (a: T) => string | null,
): { a: T; b: T }[] {
  const plain = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, "");
  const sameBank = (a: T, b: T) => {
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
  const kindsAgree = (a: T, b: T) =>
    !a.subtype || !b.subtype || family(a.subtype) === family(b.subtype);
  const out: { a: T; b: T }[] = [];
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

// What net worth and every figure beside it counts (the founder's rule, 11-24: "it should always
// match the data of Plaid and show no duplicate statements"). Plaid-linked accounts count as they
// are; an uploaded statement counts only when it can't be a copy of one of them, nor an earlier
// upload of an account uploaded again. Left out, with the account it may be and why:
//   copy         the same last four, type and subtype at another link or an upload (a certain copy);
//   maybe_same   an upload with no last four to tell it from a linked account at the same bank (or
//                a re-link naming the subtype another way), unless the person said it is another;
//   older_upload an upload of an account uploaded again: the one whose statement ends later counts
//                (its closing balance is the later one), a tie going to the newer;
//   linked_twice one account linked at two banks' logins with the same last four, named another way.
// `bankOf` is a link's bank, or null for an upload (which goes by its own name); `separate` holds the
// uploads the person said are accounts of their own; `endsOn` is each upload's statement end day and `uploadedAt` when it was uploaded (the tie-break).
export type LeftOutReason = "copy" | "maybe_same" | "older_upload" | "linked_twice";
export type LeftOut = { reason: LeftOutReason; sameAs: Acct };
export type CountAcct = Acct & { source?: string | null };
export type CountContext = {
  bankOf?: (a: CountAcct) => string | null;
  separate?: ReadonlySet<string>;
  endsOn?: ReadonlyMap<string, string>;
  uploadedAt?: ReadonlyMap<string, string>;
};

// An upload is a statement the person gave Jane; anything else was read from a bank or broker.
export const isUpload = (a: Pick<CountAcct, "source" | "itemId">) =>
  a.source ? a.source === "csv" : a.itemId === null;

export function accountsLeftOut(
  accounts: readonly CountAcct[],
  {
    bankOf = () => null,
    separate = new Set(),
    endsOn = new Map(),
    uploadedAt = new Map(),
  }: CountContext = {},
): Map<string, LeftOut> {
  const out = new Map<string, LeftOut>();
  for (const { keep, duplicate } of duplicateAccounts([...accounts])) {
    out.set(duplicate.id, { reason: "copy", sameAs: keep });
  }
  const left = accounts.filter((a) => !out.has(a.id));
  const plain = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, "");
  const related = (a: CountAcct, b: CountAcct) => {
    const [m, n] = [plain(a.name), plain(b.name)];
    return m.length >= 4 && n.length >= 4 && (m.includes(n) || n.includes(m));
  };
  // The pairs the copy rule can't settle, and two uploads of one last four and kind, which it
  // doesn't look at (both are "no link").
  const pairs = maybeSameAccounts(left, bankOf);
  const seen = new Set(pairs.map(({ a, b }) => `${a.id}|${b.id}`));
  const sorted = [...left].sort((x, y) => x.id.localeCompare(y.id));
  sorted.forEach((a, i) => {
    for (const b of sorted.slice(i + 1)) {
      if (
        isUpload(a) &&
        isUpload(b) &&
        a.mask &&
        a.mask === b.mask &&
        a.type === b.type &&
        a.subtype === b.subtype &&
        related(a, b) &&
        !seen.has(`${a.id}|${b.id}`)
      )
        pairs.push({ a, b });
    }
  });
  // Links against uploads first, so what an upload is held back for never depends on the order of
  // ids: then uploads against uploads, where the earlier statement is the earlier upload whether or
  // not it was also held back as a maybe-copy of a link (three accounts, A and B uploaded and L
  // linked, say the same in any id order: L counts, B is held back for L, A for B).
  for (const { a, b } of pairs) {
    if (isUpload(a) !== isUpload(b)) {
      const [upload, link] = isUpload(a) ? [a, b] : [b, a];
      if (!out.has(upload.id) && !separate.has(upload.id))
        out.set(upload.id, { reason: "maybe_same", sameAs: link });
    } else if (!isUpload(a) && a.mask && b.mask && !out.has(a.id) && !out.has(b.id)) {
      // Linked twice and named differently: the older link counts.
      out.set(b.id, { reason: "linked_twice", sameAs: a });
    }
  }
  // The later statement counts; a tie goes to the one uploaded last, then the newer id.
  const later = (a: CountAcct, b: CountAcct) => {
    const [x, y] = [endsOn.get(a.id) ?? "", endsOn.get(b.id) ?? ""];
    const [u, v] = [uploadedAt.get(a.id) ?? "", uploadedAt.get(b.id) ?? ""];
    return x !== y ? x > y : u !== v ? u > v : a.id > b.id;
  };
  for (const { a, b } of pairs) {
    if (!isUpload(a) || !isUpload(b)) continue;
    const [older, newer] = later(a, b) ? [b, a] : [a, b];
    if (separate.has(older.id)) continue;
    const held = out.get(older.id);
    // Behind the latest one of them: A is the earlier of B and C, said as C's earlier upload.
    if (held?.reason === "older_upload" && later(held.sameAs, newer)) continue;
    out.set(older.id, { reason: "older_upload", sameAs: newer });
  }
  return out;
}

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
  // Nothing matched (the two sides' dates never overlap): nothing is proven.
  if (used.size === 0) return { ok: false, unmatched, extra };
  // Every transaction the kept account has in the duplicate's own dates must be on the
  // duplicate too, or the two don't describe the same account.
  const dFirst = duplicate.reduce((m, t) => (t.date < m ? t.date : m), duplicate[0].date);
  const dLast = duplicate.reduce((m, t) => (t.date > m ? t.date : m), duplicate[0].date);
  // One to one: a kept transaction the duplicate's twin wasn't used for is missing from it, even
  // when an identical one was matched.
  const missingOnDuplicate = keep.filter(
    (k) => k.date >= dFirst && k.date <= dLast && !used.has(k.id),
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
