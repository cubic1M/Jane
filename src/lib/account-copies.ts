import type { ScopedDb } from "@/lib/db-scoped";
import type { MaybeSame } from "@/insights/net-worth";
import { SAME_ACCOUNT_BALANCE_SLACK_DAYS, SAME_ACCOUNT_MAX_LINES } from "@/config/detection";
import {
  accountsLeftOut,
  duplicateAccounts,
  isUpload,
  uploadLinkPairs,
  type LeftOut,
} from "@/planning/books";
import {
  balanceOnOrBefore,
  compareAccounts,
  type Line,
  type Verdict,
} from "@/planning/same-account";

// What every figure counts (src/planning/books.ts accountsLeftOut): the accounts a bank link reads
// as they are, and an uploaded statement only when it can't be a copy of one of them, nor an earlier
// upload of an account uploaded again. An account linked twice (two bank logins, or the same bank
// linked again through Link instead of reconnected) is in the database twice, with new Plaid ids for
// it and every transaction, and an account uploaded and linked is in it twice with the statement's
// old balance beside the live one. Detection counts it once (src/detection/input.ts); so must every
// page that reads accounts or transactions itself, and every one reads it here.
//
// What the person said is an account of its own: an upload with this kind and key in jane_preferences
// (the "This is a different account" tap on /import).
export const SEPARATE_ACCOUNT = { kind: "separate", keyPrefix: "account:" } as const;

type Db = Pick<
  ScopedDb,
  "accounts" | "plaidItems" | "janePreferences" | "transactions" | "importRuns" | "balanceSnapshots"
>;

async function readCounting(db: Db) {
  const accounts = await db.accounts.findMany({
    select: {
      id: true,
      itemId: true,
      name: true,
      mask: true,
      type: true,
      subtype: true,
      source: true,
      currentBalanceCents: true,
      createdAt: true,
    },
  });
  // Nothing to compare: no two accounts.
  if (accounts.length < 2)
    return { accounts, left: new Map<string, LeftOut>(), cleared: new Set<string>() };
  const uploads = accounts.filter(isUpload).map((a) => a.id);
  // Only what is needed is read: the banks' names when something is linked, and what the person
  // said (and when each file ends) when something is uploaded.
  const [items, said] = await Promise.all([
    accounts.some((a) => a.itemId !== null)
      ? db.plaidItems.findMany({ select: { id: true, institutionName: true } })
      : [],
    uploads.length === 0
      ? []
      : db.janePreferences.findMany({
          where: { kind: SEPARATE_ACCOUNT.kind },
          select: { key: true },
        }),
  ]);
  const bank = new Map(items.map((i) => [i.id, i.institutionName]));
  const bankOf = (a: { itemId: string | null }) => (a.itemId ? (bank.get(a.itemId) ?? null) : null);
  const separate = new Set(said.map((p) => p.key.slice(SEPARATE_ACCOUNT.keyPrefix.length)));
  // The upload and link pairs the copy rule can't settle: compared by what each shows below.
  const candidates = uploadLinkPairs(accounts, bankOf).filter(([u]) => !separate.has(u.id));
  // The day each upload's statement ends is the one it was uploaded with (the last day its files
  // cover, import_runs.to_date), else its latest transaction; a tie goes to the one uploaded last,
  // by the time of the very run that supplies that end day.
  const [runs, latest] =
    uploads.length < 2 && candidates.length === 0
      ? [[], []]
      : await Promise.all([
          db.importRuns.findMany({
            where: { accountId: { in: uploads }, kind: "upload", toDate: { not: null } },
            select: { accountId: true, toDate: true, createdAt: true },
          }),
          db.transactions.groupBy({
            by: ["accountId"],
            where: { accountId: { in: uploads } },
            _max: { date: true },
          }),
        ]);
  const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
  const endsOn = new Map<string, string>();
  for (const t of latest) if (day(t._max.date)) endsOn.set(t.accountId, day(t._max.date)!);
  const uploadedAt = new Map(
    accounts.filter(isUpload).map((a) => [a.id, a.createdAt.toISOString()] as const),
  );
  const supplied = new Map<string, { end: string; at: string }>();
  for (const r of runs) {
    if (!r.accountId || !r.toDate) continue;
    const mine = { end: day(r.toDate)!, at: r.createdAt.toISOString() };
    const known = supplied.get(r.accountId);
    if (!known || mine.end > known.end || (mine.end === known.end && mine.at > known.at))
      supplied.set(r.accountId, mine);
  }
  for (const [id, { end, at }] of supplied) {
    endsOn.set(id, end);
    uploadedAt.set(id, at);
  }
  // Compare each such upload with the link it sits beside, by their lines over the days both cover
  // and the closing balance against the link's on that day (src/planning/same-account.ts). The
  // newest SAME_ACCOUNT_MAX_LINES of each account are read, one more than that to know there were
  // more, and a comparison that was cut short never says "different".
  const evidence = new Map<string, Verdict>();
  if (candidates.length > 0) {
    const ids = [...new Set(candidates.flatMap(([u, l]) => [u.id, l.id]))];
    const [perAccount, readings] = await Promise.all([
      Promise.all(
        ids.map(async (id) => ({
          id,
          // Posted lines only: a pending charge isn't on a statement (a tip changes its amount).
          rows: await db.transactions.findMany({
            where: { accountId: id, pending: false },
            select: { date: true, amountCents: true },
            orderBy: [{ date: "desc" }, { amountCents: "desc" }],
            take: SAME_ACCOUNT_MAX_LINES + 1,
          }),
        })),
      ),
      db.balanceSnapshots.findMany({
        where: { accountId: { in: candidates.map(([, l]) => l.id) } },
        select: { accountId: true, date: true, balanceCents: true },
      }),
    ]);
    const lines = new Map<string, { lines: Line[]; truncated: boolean }>();
    for (const { id, rows } of perAccount)
      lines.set(id, {
        lines: rows
          .slice(0, SAME_ACCOUNT_MAX_LINES)
          .map((r) => ({ date: day(r.date)!, amountCents: r.amountCents })),
        truncated: rows.length > SAME_ACCOUNT_MAX_LINES,
      });
    const readingsOf = new Map<string, { date: string; balanceCents: number }[]>();
    for (const r of readings)
      readingsOf.set(r.accountId, [
        ...(readingsOf.get(r.accountId) ?? []),
        { date: day(r.date)!, balanceCents: r.balanceCents },
      ]);
    for (const [upload, link] of candidates) {
      const end = endsOn.get(upload.id);
      const [mine, theirs] = [lines.get(upload.id), lines.get(link.id)];
      const { verdict } = compareAccounts({
        upload: mine?.lines ?? [],
        link: theirs?.lines ?? [],
        truncated: Boolean(mine?.truncated || theirs?.truncated),
        closing:
          end && upload.currentBalanceCents !== null
            ? { date: end, cents: upload.currentBalanceCents }
            : null,
        linkBalanceOn: (date) =>
          balanceOnOrBefore(readingsOf.get(link.id) ?? [], date, SAME_ACCOUNT_BALANCE_SLACK_DAYS),
      });
      evidence.set(`${upload.id}|${link.id}`, verdict);
    }
  }
  const cleared = new Set<string>();
  const left = accountsLeftOut(accounts, {
    bankOf,
    separate,
    endsOn,
    uploadedAt,
    evidence,
    cleared,
  });
  return { accounts, left, cleared };
}

// The accounts left out of every figure, each with the account it may be and why.
export async function accountsNotCounted(db: Db): Promise<Map<string, LeftOut>> {
  return (await readCounting(db)).left;
}

// What is counted, read once for a load: the accounts left out, and for each the counted account it
// ends on (an upload left out for a later upload that is left out for a link ends on the link).
// Readers that need more than the ids (what a left-out copy knows that the account kept doesn't:
// reconcileLiabilities, representativeOf) read it once and pass it down, so one load never counts
// with two different sets.
export type Counting = {
  left: ReadonlyMap<string, LeftOut>;
  copies: ReadonlySet<string>;
  representativeOf: (accountId: string) => string;
};
const isCounting = (x: Db | Counting): x is Counting => "representativeOf" in x;

export function countingOf(left: ReadonlyMap<string, LeftOut>): Counting {
  const representativeOf = (accountId: string) => {
    const seen = new Set<string>();
    let at = accountId;
    while (left.has(at) && !seen.has(at)) {
      seen.add(at);
      at = left.get(at)!.sameAs.id;
    }
    return at;
  };
  return { left, copies: new Set(left.keys()), representativeOf };
}
export async function loadCounting(db: Db): Promise<Counting> {
  return countingOf(await accountsNotCounted(db));
}
const countingFrom = (from: Db | Counting) => (isCounting(from) ? from : loadCounting(from));

// The uploads counted although they sit beside a linked account of the same bank and kind: what
// each shows says they are another account (src/planning/same-account.ts). Said to the invariant,
// which would otherwise ask why they are counted.
export async function uploadsClearedByEvidence(db: Db): Promise<Set<string>> {
  return (await readCounting(db)).cleared;
}

// What is left out for want of proof it is another account, in the words under net worth
// (src/insights/net-worth.ts): not the certain copies, which the books check says, and only accounts
// with a balance, since one without is not counted anyway.
export async function leftOutNotes(db: Db): Promise<(MaybeSame & { id: string })[]> {
  const { accounts, left } = await readCounting(db);
  const byId = new Map(accounts.map((a) => [a.id, a]));
  return [...left].flatMap(([id, { reason, sameAs }]) => {
    const account = byId.get(id);
    return reason === "copy" || !account || account.currentBalanceCents === null
      ? []
      : [{ id, reason, left: { name: account.name }, with: { name: sameAs.name } }];
  });
}

// The ids of the accounts to leave out.
export async function accountCopies(from: Db | Counting): Promise<Set<string>> {
  return new Set((await countingFrom(from)).copies);
}

// The `where` for a read of accounts that adds or reads their balances itself: only the ones counted.
export async function onlyCounted(from: Db | Counting): Promise<{ id?: { notIn: string[] } }> {
  const copies = await accountCopies(from);
  return copies.size === 0 ? {} : { id: { notIn: [...copies] } };
}

// The same for a read of the rows kept by account (holdings, liabilities, investment transactions):
// only the ones on a counted account, so an account linked twice, or uploaded and linked, is not
// added twice in a total or a suggestion.
export async function onlyCountedRows(
  from: Db | Counting,
): Promise<{ accountId?: { notIn: string[] } }> {
  const copies = await accountCopies(from);
  return copies.size === 0 ? {} : { accountId: { notIn: [...copies] } };
}

// The facts of a liability (rate, what the lender reported paid) a counted account may lack and a
// left-out copy of it carries: leaving the copy out of the figures must not throw them away
// (CodeRabbit on #2259, ten times over). Rows are every liability read, unfiltered by account; the
// result is the rows on counted accounts, each filled in from the copies that end on it, following
// the chain (an upload left out for an upload left out for a link). A field the counted row has is
// never replaced, and no balance is ever added: balances sit on the account, which stays as it is.
// The lender's interest travels with the date it was read on (`lastPaymentDate`, `updatedAt`), so
// the year and the annualising still go by the reading that gave the figure.
const READING = ["ytdInterestPaidCents", "lastPaymentDate", "updatedAt"] as const;
export function reconcileLiabilities<T extends { accountId: string }>(
  counting: Counting,
  rows: readonly T[],
  // For a figure said for one year (the tax pack, the organizer, home taxes): only a reading taken in
  // that year (`updatedAt`) can supply the interest, the account's own or a copy's, and with none the
  // interest is left unknown rather than taken from another year's reading.
  { readingYear }: { readingYear?: number } = {},
): T[] {
  if (counting.copies.size === 0 && readingYear === undefined) return [...rows];
  const copiesOf = new Map<string, T[]>();
  for (const r of [...rows].sort((a, b) => a.accountId.localeCompare(b.accountId))) {
    if (!counting.copies.has(r.accountId)) continue;
    const rep = counting.representativeOf(r.accountId);
    copiesOf.set(rep, [...(copiesOf.get(rep) ?? []), r]);
  }
  const readIn = (r: unknown) => {
    const at = (r as Record<string, unknown>).updatedAt;
    return at instanceof Date ? at.getUTCFullYear() : null;
  };
  const cents = (r: unknown) =>
    ((r as Record<string, unknown>).ytdInterestPaidCents ?? 0) as number;
  return rows
    .filter((r) => !counting.copies.has(r.accountId))
    .map((row) => {
      const copies = copiesOf.get(row.accountId) ?? [];
      if (copies.length === 0 && readingYear === undefined) return row;
      const out: Record<string, unknown> = { ...row };
      const own = row as Record<string, unknown>;
      for (const key of Object.keys(own)) {
        if (
          key === "accountId" ||
          key === "account" ||
          (READING as readonly string[]).includes(key)
        )
          continue;
        if (own[key] === null || own[key] === undefined) {
          const from = copies.find((c) => (c as Record<string, unknown>)[key] != null);
          if (from) out[key] = (from as Record<string, unknown>)[key];
        }
      }
      if ("ytdInterestPaidCents" in own) {
        // The reading to take: the largest figure among the account's own and its copies', and for a
        // year only among the ones read in it (the account's own wins a tie).
        const pool = [row, ...copies].filter(
          (r) =>
            readingYear === undefined ||
            (readIn(r) === readingYear &&
              (r as Record<string, unknown>).ytdInterestPaidCents != null),
        );
        const best = pool.reduce<T | null>(
          (m, c) => (m === null || cents(c) > cents(m) ? c : m),
          null,
        );
        if (best === null) out.ytdInterestPaidCents = null;
        else if (best !== row)
          for (const key of READING)
            if (key in own) out[key] = (best as Record<string, unknown>)[key];
      }
      return out as T;
    });
}

// Lines (investment transactions, say) of the counted accounts, with the lines only a left-out copy
// has: an upload of an IRA left out for the link carries the contributions made before the link began,
// and they count toward the year's room once. Every line is attributed to the counted account its
// account ends on; for each account, day and amount, the most that any one of the accounts that end on
// it shows is kept (the account's own, or one copy's): the lines they share are one line, and a
// repeated line on one account stays repeated. Nothing is added twice, and no balance comes with it.
export function foldCopiesInto<T extends { accountId: string; amountCents: number; date: Date }>(
  counting: Counting,
  rows: readonly T[],
  // A label that makes two lines of one day and amount two lines when it differs (an employer's
  // contribution against the person's own): a line is the same one only if its class is too.
  classOf: (row: T) => string = () => "",
): T[] {
  const groups = new Map<string, { rep: string; bySource: Map<string, T[]> }>();
  for (const r of rows) {
    const rep = counting.representativeOf(r.accountId);
    const key = `${rep}|${r.date.toISOString().slice(0, 10)}|${r.amountCents}|${classOf(r)}`;
    const group = groups.get(key) ?? { rep, bySource: new Map() };
    group.bySource.set(r.accountId, [...(group.bySource.get(r.accountId) ?? []), r]);
    groups.set(key, group);
  }
  const kept: T[] = [];
  for (const { rep, bySource } of groups.values()) {
    const sources = [...bySource].sort(
      ([a, x], [b, y]) =>
        y.length - x.length || Number(b === rep) - Number(a === rep) || a.localeCompare(b),
    );
    const [source, lines] = sources[0];
    for (const line of lines) kept.push(source === rep ? line : { ...line, accountId: rep });
  }
  return kept;
}

// The rows that aren't on a copy, by the account id each names.
export const withoutCopies = <T>(
  rows: readonly T[],
  copies: ReadonlySet<string>,
  accountIdOf: (row: T) => string,
): T[] => (copies.size === 0 ? [...rows] : rows.filter((r) => !copies.has(accountIdOf(r))));

// The copies to leave out of accounts already read, and for each the id of the account kept in its
// place (a home linked to a copy is linked to the loan kept). Found in the rows given, so the
// copies always describe the balances counted from them.
export function copiesAndKeepers(
  accounts: {
    id: string;
    itemId: string | null;
    mask: string | null;
    type: string;
    subtype: string | null;
  }[],
): { copies: Set<string>; keeper: Map<string, string> } {
  const found = duplicateAccounts(accounts.map((a) => ({ ...a, name: "" })));
  return {
    copies: new Set(found.map((d) => d.duplicate.id)),
    keeper: new Map(found.map((d) => [d.duplicate.id, d.keep.id])),
  };
}
