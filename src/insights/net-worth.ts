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
  // Whether anything counted has a value: false when every balance is unknown (statements
  // without a balance column) and nothing owned is entered, so netCents' 0 means "not known".
  known: boolean;
};

const isDebt = (type: string) => DEBT_ACCOUNT_TYPES.includes(type);

export function netWorth(
  accounts: NetWorthAccount[],
  owned: OwnedValue[] = [],
  cryptoCents = 0,
): NetWorth {
  let assets = 0;
  let investments = 0;
  let debts = 0;
  const missing: string[] = [];
  for (const a of accounts) {
    if (a.balanceCents === null) {
      missing.push(a.name);
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
    missing: missing.sort(),
    known: accounts.length > missing.length || owned.length > 0 || cryptoCents > 0,
  };
}

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
  const months = monthlyNetWorth(
    accounts,
    [
      ...snapshots,
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
