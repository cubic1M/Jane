import { NET_WORTH_MONTHS } from "@/config/net-worth";
import type { PrismaClient } from "@/generated/prisma/client";
import { netWorth, netWorthLine } from "@/insights/net-worth";
import { monthsEnding } from "@/insights/spending";
import { cryptoTotal } from "@/lib/crypto/crypto";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { todayOf } from "@/lib/today";

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
): Promise<{ todayCents: number; months: { month: string; netCents: number | null }[] } | null> {
  const db = scopedFor(userId, client);
  const asOf = await todayOf(userId, { client, now });
  const [first] = monthsEnding(asOf, months);
  const [accounts, snapshots, ownedRows, crypto] = await Promise.all([
    db.accounts.findMany({
      select: { id: true, name: true, type: true, subtype: true, currentBalanceCents: true },
    }),
    db.balanceSnapshots.findMany({
      where: { date: { gte: new Date(`${first}-01T00:00:00Z`) } },
      select: { accountId: true, date: true, balanceCents: true },
    }),
    db.ownedAssets.findMany({
      select: { id: true, valueCents: true, valuedOn: true, loanAccountId: true },
    }),
    cryptoTotal(userId, { client }),
  ]);
  if (accounts.length === 0) return null;
  const owned = ownedRows.map((o) => ({ ...o, valuedOn: o.valuedOn.toISOString().slice(0, 10) }));
  const today = netWorth(
    accounts.map((a) => ({ ...a, balanceCents: a.currentBalanceCents })),
    owned,
    crypto,
  );
  return {
    todayCents: today.netCents,
    months: netWorthLine(
      accounts,
      snapshots.map((s) => ({ ...s, date: s.date.toISOString().slice(0, 10) })),
      owned,
      asOf,
      months,
      today.netCents,
    ),
  };
}

// The accounts net worth can't count yet for want of a balance, by name (src/insights/net-worth.ts
// notCounting says so beside the figure).
export async function accountsWithoutBalance(
  userId: string,
  { client = defaultClient }: { client?: PrismaClient } = {},
): Promise<string[]> {
  const rows = await scopedFor(userId, client).accounts.findMany({
    where: { currentBalanceCents: null },
    select: { name: true },
    orderBy: { name: "asc" },
  });
  return rows.map((r) => r.name);
}
