import Link from "next/link";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { formatCents } from "@/lib/money";
import { storedReport } from "@/lib/monthly-report-store";
import { requireUser } from "@/lib/session";
import { monthName, reportLines } from "@/planning/monthly-report";

// The monthly money report (spec step 148), as kept when it was made: each figure with a
// link to the page it comes from, and every receipt.

const MONTH = /^\d{4}-\d{2}$/;
const MUTED = "text-zinc-600 dark:text-zinc-400";
const LINK = "text-sm font-medium text-emerald-700 hover:underline";

async function MonthlyContent({
  searchParams,
}: {
  searchParams: PageProps<"/monthly">["searchParams"];
}) {
  const user = await requireUser();
  const { m } = await searchParams;
  const stored = await storedReport(user.id, typeof m === "string" && MONTH.test(m) ? m : null);

  if (!stored) {
    return (
      <>
        <AppHeader user={user} />
        <h1 className="text-3xl font-semibold tracking-tight">Monthly money report</h1>
        <p className={MUTED}>
          Your first report comes at the start of next month: what you saved, earned, paid down and
          moved, with the receipts.
        </p>
      </>
    );
  }
  const { report } = stored;
  return (
    <>
      <AppHeader user={user} />
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">
          {monthName(report.month)} money report
        </h1>
        <p className={MUTED}>
          Made {stored.createdAt.toISOString().slice(0, 10)}. Each figure comes from the page it
          links to.
        </p>
      </div>
      <ul className="flex flex-col gap-3">
        {reportLines(report).map((line) => (
          <li
            key={line.label}
            className="flex flex-col gap-1 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
          >
            <span className="flex flex-wrap items-baseline justify-between gap-x-4">
              <span className="font-semibold">{line.label}</span>
              <Link href={line.href} className={LINK}>
                See it<span className="sr-only">: {line.label}</span>
              </Link>
            </span>
            <span>{line.text}</span>
          </li>
        ))}
      </ul>
      <section className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold">Receipts</h2>
        {report.receipts.length === 0 ? (
          <p className={MUTED}>No new savings confirmed by your transactions this month.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {report.receipts.map((r) => (
              <li key={`${r.title}-${r.proof}`} className="flex flex-col gap-1 text-sm">
                <span className="font-medium">
                  {r.title}: {formatCents(r.cents)}
                  {r.yearly ? " a year" : " back"}
                </span>
                <span className={MUTED}>{r.proof}</span>
              </li>
            ))}
          </ul>
        )}
        <Link href="/saved" className={LINK}>
          Every receipt
        </Link>
      </section>
    </>
  );
}

export default function MonthlyPage({ searchParams }: PageProps<"/monthly">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <MonthlyContent searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
