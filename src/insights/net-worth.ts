import { DEBT_ACCOUNT_TYPES } from "@/config/net-worth";
import { monthsEnding } from "./spending";

// Net worth: what the person holds minus what they owe, from account balances. Credit
// cards and loans report what's owed as a positive balance, so they count as debts.
// Accounts with no balance are left out, and listed so the person knows. Things the person
// owns (spec step 67) count as assets at the value they gave, and crypto (spec step 161) at
// what its exchange or wallet last reported. Pure.

export type NetWorthAccount = {
  id: string;
  name: string;
  type: string;
  balanceCents: number | null;
};

// A home, car or other thing of value, at the value the person gave on the day they gave it.
export type OwnedValue = { id: string; valueCents: number; valuedOn: string };

export type NetWorth = {
  assetsCents: number;
  // Of the assets, what's in investment and retirement accounts (spec step 66).
  investmentsCents: number;
  // Of the assets, the things the person owns, at their own values (spec step 67).
  ownedCents: number;
  // Of the assets, crypto read from exchanges and wallets (spec step 161).
  cryptoCents: number;
  debtsCents: number;
  netCents: number;
  // Accounts we couldn't include, by name.
  missing: string[];
  // The same, with whether each is a card (what's owed): for notCounting's words.
  unbalanced: Unbalanced[];
  // Whether anything counted has a value: false when every balance is unknown (statements
  // without a balance column) and nothing owned is entered, so netCents' 0 means "not known".
  known: boolean;
  // Nothing but cards and loans on file: what the person has isn't $0, it's not known.
  onlyDebts: boolean;
};

export type Unbalanced = { name: string; card: boolean };

// A card or loan: what it holds is owed.
export const isDebt = (type: string) => DEBT_ACCOUNT_TYPES.includes(type);

export function netWorth(
  accounts: NetWorthAccount[],
  owned: OwnedValue[] = [],
  cryptoCents = 0,
): NetWorth {
  let assets = 0;
  let investments = 0;
  let debts = 0;
  const unbalanced: Unbalanced[] = [];
  for (const a of accounts) {
    if (a.balanceCents === null) {
      unbalanced.push({ name: a.name, card: isDebt(a.type) });
      continue;
    }
    if (isDebt(a.type)) debts += a.balanceCents;
    else assets += a.balanceCents;
    if (a.type === "investment") investments += a.balanceCents;
  }
  const ownedCents = owned.reduce((sum, o) => sum + o.valueCents, 0);
  assets += ownedCents + cryptoCents;
  return {
    assetsCents: assets,
    investmentsCents: investments,
    ownedCents,
    cryptoCents,
    debtsCents: debts,
    netCents: assets - debts,
    missing: unbalanced.map((u) => u.name).sort(),
    unbalanced: unbalanced.sort((a, b) => a.name.localeCompare(b.name)),
    known: accounts.length > unbalanced.length || owned.length > 0 || cryptoCents > 0,
    onlyDebts:
      accounts.length > 0 &&
      accounts.every((a) => isDebt(a.type)) &&
      owned.length === 0 &&
      cryptoCents === 0,
  };
}

// What the figure covers, said under it (the founder's Home, 11-23: "not my current net worth", with
// nothing on the page saying which accounts it held): the accounts counted, by kind, and whether
// any investment or retirement account is in it. A brokerage that isn't linked, or that Jane can't
// read, isn't in net worth, and the figure never said so. Null when nothing is counted.
export function netWorthCovers(
  accounts: readonly Pick<NetWorthAccount, "type" | "balanceCents">[],
  { owned = 0, crypto = false }: { owned?: number; crypto?: boolean } = {},
): string | null {
  const counted = accounts.filter((a) => a.balanceCents !== null);
  const n = (type: (t: string) => boolean) => counted.filter((a) => type(a.type)).length;
  const plural = (count: number, one: string, many: string) =>
    `${count} ${count === 1 ? one : many}`;
  const invested = n((t) => t === "investment");
  const parts = [
    n((t) => t === "depository") > 0 &&
      plural(
        n((t) => t === "depository"),
        "bank account",
        "bank accounts",
      ),
    n((t) => t === "credit") > 0 &&
      plural(
        n((t) => t === "credit"),
        "card",
        "cards",
      ),
    n((t) => t === "loan") > 0 &&
      plural(
        n((t) => t === "loan"),
        "loan",
        "loans",
      ),
    invested > 0 && plural(invested, "investment account", "investment accounts"),
    owned > 0 && plural(owned, "thing you own", "things you own"),
    crypto && "your crypto",
  ].filter((p): p is string => typeof p === "string");
  if (parts.length === 0) return null;
  const list =
    parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
  return `Counts ${list}.${invested > 0 ? "" : " No investment or retirement account is in it."}`;
}

// An account net worth leaves out because it may be one already counted (src/planning/books.ts
// accountsLeftOut), said under the figure on Home and Money and on the books notice, with a quiet link to
// see them (the person can say one is another account there). One by name, and many as a count.
export type MaybeSame = {
  reason: "same_account" | "maybe_same" | "older_upload" | "linked_twice";
  left: { name: string };
  with: { name: string };
};
export const maybeSamePair = ({ reason, left, with: other }: MaybeSame) =>
  reason === "same_account"
    ? `${left.name} (uploaded) shows the same activity as ${other.name} (linked), so Jane left it out of net worth.`
    : reason === "maybe_same"
      ? `${left.name} (uploaded) looks like a copy of ${other.name} (linked), and there was not enough in their lines to be sure, so Jane left it out of net worth.`
      : reason === "older_upload"
        ? `${left.name} (uploaded) looks like an earlier upload of ${other.name}, so Jane counted the later one only.`
        : `${left.name} looks like ${other.name} linked a second time, so Jane counts it once.`;
// Where to look: the import page for an upload (where one tap says it is another account), the
// bank links for a second link. Said as a quiet link, never as something to do.
export const maybeSameHref = (pairs: readonly MaybeSame[]) =>
  pairs.some((p) => p.reason !== "linked_twice") ? "/import" : "/settings#banks";
// What Jane did, in words: the one account by name, and many as a count.
export function maybeSameWords(pairs: readonly MaybeSame[]): string | null {
  const [only, ...more] = pairs;
  if (!only) return null;
  if (more.length === 0) return maybeSamePair(only);
  const copies = (r: MaybeSame["reason"]) => r === "same_account" || r === "maybe_same";
  if (!pairs.every((p) => copies(p.reason)))
    return `${pairs.length} of your accounts look like copies of ones already counted, so they are left out of net worth.`;
  const unsure = pairs.filter((p) => p.reason === "maybe_same").length;
  return `${pairs.length} uploaded statements look like copies of your linked accounts, so they are left out of net worth.${
    unsure > 0
      ? ` Jane could not be sure of ${unsure === pairs.length ? "them" : `${unsure} of them`} from the bank's own lines.`
      : ""
  }`;
}
// The same in one sentence, for a line with room for one (Money's net worth).
export const maybeSameShort = maybeSameWords;

// Said beside the figure when only a card or loan is on file (debugger 11-04: "You have $0.00",
// paying a card $2,900 a month from an account Jane has never seen).
export const NO_BANK_SEEN =
  "Not counting any bank account: Jane has seen what you owe, not the account you pay it from.";

export type Snapshot = { accountId: string; date: string; balanceCents: number };

// Net worth on a past day: each account's last snapshot on or before it. Null when no
// account had a snapshot by then.
export function netWorthOn(
  accounts: Pick<NetWorthAccount, "id" | "type">[],
  snapshots: Snapshot[],
  date: string,
): number | null {
  const typeOf = new Map(accounts.map((a) => [a.id, a.type]));
  const latest = new Map<string, Snapshot>();
  for (const s of snapshots) {
    if (!typeOf.has(s.accountId) || s.date > date) continue;
    const known = latest.get(s.accountId);
    if (!known || s.date > known.date) latest.set(s.accountId, s);
  }
  if (latest.size === 0) return null;
  let net = 0;
  for (const [accountId, s] of latest) {
    net += isDebt(typeOf.get(accountId) ?? "") ? -s.balanceCents : s.balanceCents;
  }
  return net;
}

// Net worth at the end of each month: each account's last snapshot in or before that
// month. Months before any snapshot have no value. Each thing owned counts like an account
// with one snapshot: its value, from the day it was valued.
export function monthlyNetWorth(
  realAccounts: Pick<NetWorthAccount, "id" | "type">[],
  realSnapshots: Snapshot[],
  asOf: string,
  monthCount: number,
  owned: OwnedValue[] = [],
): { month: string; netCents: number | null }[] {
  const accounts = [...realAccounts, ...owned.map((o) => ({ id: `owned:${o.id}`, type: "owned" }))];
  const snapshots = [
    ...realSnapshots,
    ...owned.map((o) => ({
      accountId: `owned:${o.id}`,
      date: o.valuedOn,
      balanceCents: o.valueCents,
    })),
  ];
  const typeOf = new Map(accounts.map((a) => [a.id, a.type]));
  const byAccount = new Map<string, Snapshot[]>();
  for (const s of [...snapshots].sort((a, b) => a.date.localeCompare(b.date))) {
    if (!typeOf.has(s.accountId)) continue;
    byAccount.set(s.accountId, [...(byAccount.get(s.accountId) ?? []), s]);
  }
  return monthsEnding(asOf, monthCount).map((month) => {
    let net = 0;
    let any = false;
    for (const [accountId, rows] of byAccount) {
      const last = rows.filter((r) => r.date.slice(0, 7) <= month).at(-1);
      if (!last) continue;
      any = true;
      net += isDebt(typeOf.get(accountId) ?? "") ? -last.balanceCents : last.balanceCents;
    }
    return { month, netCents: any ? net : null };
  });
}

// The net worth line the hub and /net-worth both draw, so they agree with each other and with
// the headline (phone walk: the page jumped by a car's value in the month it was first valued
// and ended at a month-old snapshot). How the accounts moved: things owned count across the
// whole window at their value now, and so does an account with no balance history yet (a
// sample person's investments, an account linked today); this month is today's net worth.
export function netWorthLine(
  accounts: { id: string; type: string; currentBalanceCents: number | null }[],
  snapshots: Snapshot[],
  owned: OwnedValue[],
  asOf: string,
  monthCount: number,
  todayCents: number,
): { month: string; netCents: number | null }[] {
  const ends = monthsEnding(asOf, monthCount);
  // No history at all (a bank linked today): only this month, never a made-up flat year.
  if (snapshots.length === 0)
    return ends.map((month, i) => ({ month, netCents: i === ends.length - 1 ? todayCents : null }));
  const start = `${ends[0]}-01`;
  const kept = new Set(snapshots.map((s) => s.accountId));
  // Before an account's first balance it counts at that balance, as the chart does: adding a
  // savings file isn't a gain (debugger 11-04). Only back to the first balance of any account, so
  // months before anything was known stay empty.
  const inOrder = [...snapshots].sort((a, b) => a.date.localeCompare(b.date));
  const firstOf = new Map<string, Snapshot>();
  for (const s of inOrder) if (!firstOf.has(s.accountId)) firstOf.set(s.accountId, s);
  const carried = [...firstOf.values()]
    .filter((s) => s.date > inOrder[0].date)
    .map((s) => ({ ...s, date: inOrder[0].date }));
  const months = monthlyNetWorth(
    accounts,
    [
      ...snapshots,
      ...carried,
      ...accounts
        .filter((a) => !kept.has(a.id) && a.currentBalanceCents !== null)
        .map((a) => ({ accountId: a.id, date: start, balanceCents: a.currentBalanceCents! })),
    ],
    asOf,
    monthCount,
    owned.map((o) => ({ ...o, valuedOn: o.valuedOn < start ? o.valuedOn : start })),
  );
  return months.map((m, i) => (i === months.length - 1 ? { ...m, netCents: todayCents } : m));
}

// The months to list, from the first one with a figure: three months of statements show three
// rows, not nine dashes before them. A month missing in between still shows as a gap.
export function fromFirstKnown<T extends { netCents: number | null }>(months: T[]): T[] {
  const first = months.findIndex((m) => m.netCents !== null);
  return first === -1 ? [] : months.slice(first);
}

// The loans a statement shows the payments of but never the balance of (debugger 11-03: a landlord
// paying two mortgages read "You owe $0.00"). Said beside the figure, as a left-out balance is.
export function loansNotCounted(names: readonly string[]): string | null {
  if (names.length === 0) return null;
  const which = names.length <= 2 ? names.join(" and ") : `${names.length} loans`;
  return `Not counting what you owe on ${which}: Jane sees the payments, not the balance.`;
}

// Whether "you owe $X" is a true sentence: not $0.00 when a card has no balance on file, or payments
// show a loan (debugger 11-03: "you have $11,240.55 and owe $0.00", paying a car loan). Not knowing
// isn't zero. A debt figure there is still said, with what it leaves out said beside it.
export function owedIsKnown(
  worth: { debtsCents: number; unbalanced: readonly Unbalanced[] },
  loansSeen: readonly string[],
): boolean {
  return worth.debtsCents > 0 || (loansSeen.length === 0 && !worth.unbalanced.some((u) => u.card));
}

// What a net worth leaves out for want of a balance (an uploaded card or bank file without one,
// src/lib/import/account-balance.ts), said beside the figure, never left out silently (CSV
// bench: card debt missing from most upload-only people's net worth). Null when it's complete.
// One phrase everywhere: "not counting your card balance". The short form fits a tree label;
// the sentence names the accounts.
export function notCounting(
  unbalanced: readonly Unbalanced[],
): { short: string; sentence: string } | null {
  if (unbalanced.length === 0) return null;
  const one = unbalanced.length === 1;
  const cards = unbalanced.every((u) => u.card);
  const short = cards
    ? `not counting card ${one ? "balance" : "balances"}`
    : `not counting ${one ? "a balance" : `${unbalanced.length} balances`}`;
  const names = unbalanced.length <= 2 ? unbalanced.map((u) => u.name).join(" or ") : null;
  const sentence = names
    ? `Not counting your ${names} ${one ? "balance" : "balances"}: ${one ? "the file doesn't" : "the files don't"} say ${one ? "it" : "them"} yet.`
    : `Not counting ${unbalanced.length} balances: the files don't say them yet.`;
  return { short, sentence };
}
