import { DEBT_ACCOUNT_TYPES } from "@/config/net-worth";
import { monthsEnding } from "./spending";

// Net worth: what the person holds minus what they owe, from account balances. Credit
// cards and loans report what's owed as a positive balance, so they count as debts.
// Accounts with no balance are left out, and listed so the person knows. Pure.

export type NetWorthAccount = {
  id: string;
  name: string;
  type: string;
  balanceCents: number | null;
};

export type NetWorth = {
  assetsCents: number;
  debtsCents: number;
  netCents: number;
  // Accounts we couldn't include, by name.
  missing: string[];
};

const isDebt = (type: string) => DEBT_ACCOUNT_TYPES.includes(type);

export function netWorth(accounts: NetWorthAccount[]): NetWorth {
  let assets = 0;
  let debts = 0;
  const missing: string[] = [];
  for (const a of accounts) {
    if (a.balanceCents === null) {
      missing.push(a.name);
      continue;
    }
    if (isDebt(a.type)) debts += a.balanceCents;
    else assets += a.balanceCents;
  }
  return {
    assetsCents: assets,
    debtsCents: debts,
    netCents: assets - debts,
    missing: missing.sort(),
  };
}

export type Snapshot = { accountId: string; date: string; balanceCents: number };

// Net worth at the end of each month: each account's last snapshot in or before that
// month. Months before any snapshot have no value.
export function monthlyNetWorth(
  accounts: Pick<NetWorthAccount, "id" | "type">[],
  snapshots: Snapshot[],
  asOf: string,
  monthCount: number,
): { month: string; netCents: number | null }[] {
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
