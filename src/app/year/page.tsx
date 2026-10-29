import Link from "next/link";
import { Suspense } from "react";
import { AppHeader, PageLoading } from "@/components/app-header";
import { formatCents } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { yearInReview } from "@/lib/year";
import { PrintButton } from "./print-button";
import { monthLabel } from "@/lib/day-label";

async function Year({ searchParams }: { searchParams: PageProps<"/year">["searchParams"] }) {
  const user = await requireUser();
  const now = new Date();
  const { y } = await searchParams;
  const asked = Number(y);
  const thisYear = now.getUTCFullYear();
  const year = Number.isInteger(asked) && asked >= 2000 && asked <= thisYear ? asked : thisYear;
  const review = await yearInReview(user.id, year, { now });
  const years = Array.from(
    { length: thisYear - Math.min(review.firstYear, thisYear) + 1 },
    (_, i) => thisYear - i,
  );
  const max = Math.max(1, ...review.months.map((m) => m.spendingCents));

  return (
    <>
      <div className="print:hidden">
        <AppHeader user={user} />
      </div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-semibold tracking-tight">{year} in review</h1>
          <p className="text-zinc-600 dark:text-zinc-400">
            {year === thisYear ? "So far this year" : "The whole year"}, from your accounts. Money
            moved between your own accounts and card payments aren&apos;t counted as spending.
          </p>
        </div>
        <PrintButton />
      </div>
      {years.length > 1 && (
        <nav aria-label="Years" className="flex flex-wrap gap-3 text-sm print:hidden">
          {years.map((yr) => (
            <Link
              key={yr}
              href={`/year?y=${yr}`}
              aria-current={yr === year ? "page" : undefined}
              className={yr === year ? "font-semibold" : "text-emerald-700 hover:underline"}
            >
              {yr}
            </Link>
          ))}
        </nav>
      )}

      <section className="grid gap-3 sm:grid-cols-4">
        {(
          [
            ["Spent", formatCents(review.spendingCents)],
            ["Came in", formatCents(review.incomeCents)],
            ["Jane found", `${review.found.findings} ways to save`],
            ["Saved", `${formatCents(review.savedCents)} a year`],
          ] as const
        ).map(([label, value]) => (
          <div
            key={label}
            className="flex flex-col gap-1 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
          >
            <span className="text-sm text-zinc-600 dark:text-zinc-400">{label}</span>
            <span className="text-xl font-semibold">{value}</span>
          </div>
        ))}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold">Spending by month</h2>
        <ul className="flex flex-col gap-1 text-sm">
          {review.months.map((m) => (
            <li key={m.month} className="grid grid-cols-[3rem_1fr_6.5rem] items-center gap-2">
              <span className="text-zinc-500">{monthLabel(m.month, { year: false })}</span>
              <span
                className="h-3 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-900"
                aria-hidden
              >
                <span
                  className="block h-full bg-emerald-600"
                  style={{ width: `${(m.spendingCents / max) * 100}%` }}
                />
              </span>
              <span className="text-right">{formatCents(m.spendingCents)}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold">Where it went</h2>
        {review.categories.length === 0 ? (
          <p className="text-zinc-600 dark:text-zinc-400">No spending recorded for {year}.</p>
        ) : (
          <ul className="divide-y divide-zinc-200 rounded-xl border border-zinc-200 text-sm dark:divide-zinc-800 dark:border-zinc-800">
            {review.categories.map((c) => (
              <li key={c.category} className="flex justify-between gap-2 px-4 py-2">
                <span>{c.category}</span>
                <span>{formatCents(c.cents)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {review.changes.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-xl font-semibold">Biggest changes from {year - 1}</h2>
          <ul className="flex flex-col gap-1 text-sm">
            {review.changes.map((c) => (
              <li key={c.category} className="flex flex-wrap justify-between gap-2">
                <span>{c.category}</span>
                <span>
                  {formatCents(c.lastYearCents)} → {formatCents(c.thisYearCents)} (
                  {c.changeCents > 0 ? "+" : "−"}
                  {formatCents(Math.abs(c.changeCents))})
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-1 text-sm text-zinc-600 dark:text-zinc-400">
        <p>
          Jane found {review.found.findings} way{review.found.findings === 1 ? "" : "s"} to save in{" "}
          {year}, estimated at {formatCents(review.found.annualSavingsCents)} a year. Changes you
          finished this year (with our team or yourself) save about {formatCents(review.savedCents)}{" "}
          a year.
        </p>
      </section>
    </>
  );
}

export default function YearPage({ searchParams }: PageProps<"/year">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12 print:py-0">
      <Suspense fallback={<PageLoading />}>
        <Year searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
