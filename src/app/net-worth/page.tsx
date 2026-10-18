import Link from "next/link";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { NET_WORTH_MONTHS } from "@/config/net-worth";
import { monthsEnding } from "@/insights/spending";
import { monthlyNetWorth, netWorth } from "@/insights/net-worth";
import { scopedDb } from "@/lib/db-scoped";
import { formatCents } from "@/lib/money";
import { requireUser } from "@/lib/session";

const monthLabel = (month: string) =>
  new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

async function NetWorthContent() {
  const user = await requireUser();
  const db = await scopedDb();
  const asOf = new Date().toISOString().slice(0, 10);
  const [first] = monthsEnding(asOf, NET_WORTH_MONTHS);
  const [accounts, snapshots] = await Promise.all([
    db.accounts.findMany({
      select: { id: true, name: true, type: true, currentBalanceCents: true },
      orderBy: { name: "asc" },
    }),
    db.balanceSnapshots.findMany({
      where: { date: { gte: new Date(`${first}-01T00:00:00Z`) } },
      select: { accountId: true, date: true, balanceCents: true },
    }),
  ]);
  const today = netWorth(accounts.map((a) => ({ ...a, balanceCents: a.currentBalanceCents })));
  const months = monthlyNetWorth(
    accounts,
    snapshots.map((s) => ({ ...s, date: s.date.toISOString().slice(0, 10) })),
    asOf,
    NET_WORTH_MONTHS,
  );
  const max = Math.max(1, ...months.map((m) => Math.abs(m.netCents ?? 0)));

  return (
    <>
      <AppHeader email={user.email} />
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Net worth</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          What your accounts hold minus what you owe on cards and loans, from the balances your bank
          reports.
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

      {today.missing.length > 0 && (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Not included, because there&apos;s no balance: {today.missing.join(", ")}. Add a balance
          on the{" "}
          <Link href="/import" className="font-medium text-emerald-700 hover:underline">
            import page
          </Link>
          .
        </p>
      )}

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
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <NetWorthContent />
      </Suspense>
    </main>
  );
}
