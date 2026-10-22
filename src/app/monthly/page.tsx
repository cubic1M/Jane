import Link from "next/link";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { formatCents } from "@/lib/money";
import { loadClose, type CloseView } from "@/lib/month-close";
import { storedReport } from "@/lib/monthly-report-store";
import { requireUser } from "@/lib/session";
import { categoryWords } from "@/planning/month-close";
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
  const month = typeof m === "string" && MONTH.test(m) ? m : null;
  const [stored, close] = await Promise.all([
    storedReport(user.id, month),
    // Spec step 244: the month's close, with its kept figures.
    loadClose(user.id, month ? { month } : {}),
  ]);

  if (!stored) {
    return (
      <>
        <AppHeader user={user} />
        <h1 className="text-3xl font-semibold tracking-tight">Monthly money report</h1>
        <p className={MUTED}>
          Your first report comes at the start of next month: what you saved, earned, paid down and
          moved, with the receipts.
        </p>
        {close && <MonthClose view={close} />}
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
      {close && close.month === report.month && <MonthClose view={close} />}
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

// Spec step 244: the month as Jane closed it. Its figures are kept; only a correction changes them.
function MonthClose({ view }: { view: CloseView }) {
  const f = view.figures;
  return (
    <section
      id="close"
      className="flex flex-col gap-2 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
    >
      <h2 className="text-xl font-semibold">
        {monthName(view.month)}: {view.status === "closed" ? "closed" : "closing"}
      </h2>
      {view.status === "waiting" ? (
        <p className="text-sm">
          Waiting on {view.uncertain.length} charge{view.uncertain.length === 1 ? "" : "s"} I
          wasn&apos;t sure of. Answer in the chat, or{" "}
          <Link href="/transactions" className={LINK}>
            fix their categories
          </Link>
          .
        </p>
      ) : (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <dt className={MUTED}>Came in</dt>
          <dd>{formatCents(f.incomeCents)}</dd>
          <dt className={MUTED}>Went out</dt>
          <dd>{formatCents(f.spendingCents)}</dd>
          {f.netWorthCents !== null && (
            <>
              <dt className={MUTED}>Net worth at the close</dt>
              <dd>{formatCents(f.netWorthCents)}</dd>
            </>
          )}
          {f.topCategories.map((c) => (
            <div key={c.category} className="contents">
              <dt className={MUTED}>{categoryWords(c.category)}</dt>
              <dd>{formatCents(c.cents)}</dd>
            </div>
          ))}
          <dt className={MUTED}>Books</dt>
          <dd>{f.booksOpen === 0 ? "Added up" : `${f.booksOpen} marked`}</dd>
        </dl>
      )}
      {view.correctedAt && (
        <p className={MUTED}>Updated after your correction on {view.correctedAt.slice(0, 10)}.</p>
      )}
    </section>
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
