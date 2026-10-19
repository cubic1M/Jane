import Link from "next/link";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { previousMonth } from "@/insights/check-in";
import { loadCheckIn, summaryFor } from "@/lib/check-in";
import { formatCents } from "@/lib/money";
import { requireUser } from "@/lib/session";

const MONTH = /^\d{4}-\d{2}$/;
const monthName = (month: string) =>
  new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
const signed = (cents: number) => `${cents >= 0 ? "up" : "down"} ${formatCents(Math.abs(cents))}`;

async function CheckInContent({
  searchParams,
}: {
  searchParams: PageProps<"/check-in">["searchParams"];
}) {
  const user = await requireUser();
  const { m } = await searchParams;
  const latest = previousMonth(new Date().toISOString().slice(0, 10));
  const month = typeof m === "string" && MONTH.test(m) && m <= latest ? m : latest;
  const checkIn = await loadCheckIn(user.id, month);
  const summary = await summaryFor(user.id, checkIn);
  const before = previousMonth(`${month}-01`);

  return (
    <>
      <AppHeader user={user} />
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">{monthName(month)} check-in</h1>
        <p className="text-lg">{summary}</p>
        <Link
          href={`/check-in?m=${before}`}
          className="self-start text-sm font-medium text-emerald-700 hover:underline"
        >
          ‹ {monthName(before)}
        </Link>
      </div>

      <section className="grid gap-3 sm:grid-cols-3">
        {(
          [
            [
              "Spent",
              formatCents(checkIn.spendingCents),
              `${signed(checkIn.spendingCents - checkIn.previousSpendingCents)} from the month before`,
            ],
            ["Came in", formatCents(checkIn.incomeCents), ""],
            [
              "Net worth",
              checkIn.netWorth ? formatCents(checkIn.netWorth.endCents) : "–",
              checkIn.netWorth
                ? signed(checkIn.netWorth.endCents - checkIn.netWorth.startCents)
                : "No balance history yet",
            ],
          ] as const
        ).map(([label, value, note]) => (
          <div
            key={label}
            className="flex flex-col gap-1 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
          >
            <span className="text-sm text-zinc-600 dark:text-zinc-400">{label}</span>
            <span className="text-2xl font-semibold">{value}</span>
            {note && <span className="text-xs text-zinc-500">{note}</span>}
          </div>
        ))}
      </section>

      {checkIn.budgets.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-xl font-semibold">Budgets</h2>
          <ul className="divide-y divide-zinc-200 rounded-xl border border-zinc-200 text-sm dark:divide-zinc-800 dark:border-zinc-800">
            {checkIn.budgets.map((b) => (
              <li key={b.category} className="flex justify-between gap-2 px-4 py-2">
                <span>{b.category}</span>
                <span className={b.kept ? "" : "font-semibold text-red-700"}>
                  {formatCents(b.spentCents)} of {formatCents(b.budgetCents)}
                  {b.kept ? "" : " (over)"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {checkIn.changes.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-xl font-semibold">Biggest changes from {monthName(before)}</h2>
          <ul className="flex flex-col gap-1 text-sm">
            {checkIn.changes.map((c) => (
              <li key={c.category} className="flex justify-between gap-2">
                <span>{c.category}</span>
                <span>{signed(c.changeCents)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-1 text-sm text-zinc-600 dark:text-zinc-400">
        <p>
          Jane found {checkIn.found.findings} way{checkIn.found.findings === 1 ? "" : "s"} to save
          this month. Changes finished this month save about {formatCents(checkIn.savedCents)} a
          year.
        </p>
      </section>
    </>
  );
}

export default function CheckInPage({ searchParams }: PageProps<"/check-in">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <CheckInContent searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
