import Link from "next/link";
import { ShownLink } from "@/components/shown-link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { AssetPrompts } from "@/components/asset-prompts";
import { NET_WORTH_MONTHS } from "@/config/net-worth";
import { monthsEnding } from "@/insights/spending";
import { netWorth, netWorthLine, notCounting } from "@/insights/net-worth";
import { scopedDb } from "@/lib/db-scoped";
import { formatCents } from "@/lib/money";
import { assetPrompts } from "@/lib/owned-assets";
import { cryptoTotal } from "@/lib/crypto/crypto";
import { requireUser } from "@/lib/session";
import { BooksNotice } from "@/components/books-notice";
import { openBooks } from "@/lib/books";
import { LoadingBar } from "@/components/loading-bar";
import { monthLabel } from "@/lib/day-label";

async function NetWorthContent() {
  const user = await requireUser();
  await connection();
  const db = await scopedDb();
  const asOf = new Date().toISOString().slice(0, 10);
  const [first] = monthsEnding(asOf, NET_WORTH_MONTHS);
  const [accounts, snapshots, ownedRows, crypto] = await Promise.all([
    db.accounts.findMany({
      select: { id: true, name: true, type: true, subtype: true, currentBalanceCents: true },
      orderBy: { name: "asc" },
    }),
    db.balanceSnapshots.findMany({
      where: { date: { gte: new Date(`${first}-01T00:00:00Z`) } },
      select: { accountId: true, date: true, balanceCents: true },
    }),
    // Things you own, at your values (spec step 67).
    db.ownedAssets.findMany({
      select: { id: true, valueCents: true, valuedOn: true, loanAccountId: true },
    }),
    // Crypto, read-only (spec step 161).
    cryptoTotal(user.id),
  ]);
  const owned = ownedRows.map((o) => ({ ...o, valuedOn: o.valuedOn.toISOString().slice(0, 10) }));
  const today = netWorth(
    accounts.map((a) => ({ ...a, balanceCents: a.currentBalanceCents })),
    owned,
    crypto,
  );
  // The same line as the hub's, ending at today's net worth.
  const months = netWorthLine(
    accounts,
    snapshots.map((s) => ({ ...s, date: s.date.toISOString().slice(0, 10) })),
    owned,
    asOf,
    NET_WORTH_MONTHS,
    today.netCents,
  );
  const left = notCounting(today.missing);
  const prompts = assetPrompts(
    accounts,
    ownedRows.map((o) => o.loanAccountId),
  );
  const max = Math.max(1, ...months.map((m) => Math.abs(m.netCents ?? 0)));

  return (
    <>
      <AppHeader user={user} />
      <BooksNotice books={await openBooks(user.id)} />
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Net worth</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          What your accounts hold minus what you owe on cards and loans, from the balances your bank
          reports.{" "}
          <Link href="/figures/net_worth" className="font-medium text-emerald-700 hover:underline">
            How did I get this?
          </Link>
        </p>
      </div>

      <section className="grid gap-3 sm:grid-cols-3">
        {[
          ["You have", today.assetsCents],
          ["You owe", today.debtsCents],
          ["Net worth", today.netCents],
        ].map(([label, cents]) => (
          <div
            key={label}
            className="flex flex-col gap-1 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
          >
            <span className="text-sm text-zinc-600 dark:text-zinc-400">{label}</span>
            <span className="text-2xl font-semibold">{formatCents(Number(cents))}</span>
          </div>
        ))}
      </section>

      {/* Never a figure that silently leaves a debt out (an uploaded card with no balance). */}
      {left && (
        <p data-net-worth-not-counting="" className="text-sm font-medium">
          {left.sentence}{" "}
          <Link href="/import" className="underline">
            Add a balance
          </Link>
        </p>
      )}

      {today.investmentsCents > 0 && (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          What you have includes {formatCents(today.investmentsCents)} in retirement and investment
          accounts, at the balance they report.{" "}
          <Link href="/investments" className="font-medium text-emerald-700 hover:underline">
            See what&apos;s in them
          </Link>
        </p>
      )}

      {today.cryptoCents > 0 && (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Includes {formatCents(today.cryptoCents)} in crypto, as your exchange or wallet last
          reported it (read-only).{" "}
          <ShownLink
            href="/investments/crypto"
            className="font-medium text-emerald-700 hover:underline"
          >
            See your crypto
          </ShownLink>
        </p>
      )}

      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        {today.ownedCents > 0 ? (
          <>
            Includes {formatCents(today.ownedCents)} for things you own (your values).{" "}
            <Link href="/things" className="font-medium text-emerald-700 hover:underline">
              Things you own
            </Link>
          </>
        ) : (
          <>
            Own a home or a car?{" "}
            <Link href="/things" className="font-medium text-emerald-700 hover:underline">
              Add what it&apos;s worth
            </Link>{" "}
            to count it.
          </>
        )}
      </p>

      <AssetPrompts prompts={prompts} />

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">Month by month</h2>
        {months.every((m) => m.netCents === null) ? (
          <p className="text-zinc-600 dark:text-zinc-400">
            We take a snapshot of your balances each day; this fills in from today.
          </p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {months.map((m) => (
              <li key={m.month} className="grid grid-cols-[5.5rem_1fr_7rem] items-center gap-2">
                <span className="text-zinc-500">{monthLabel(m.month)}</span>
                <span
                  className="h-3 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-900"
                  aria-hidden
                >
                  {m.netCents !== null && (
                    <span
                      className={`block h-full ${m.netCents < 0 ? "bg-red-500" : "bg-emerald-600"}`}
                      style={{ width: `${(Math.abs(m.netCents) / max) * 100}%` }}
                    />
                  )}
                </span>
                <span className="text-right">
                  {m.netCents === null ? "–" : formatCents(m.netCents)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

export default function NetWorthPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<LoadingBar />}>
        <NetWorthContent />
      </Suspense>
    </main>
  );
}
