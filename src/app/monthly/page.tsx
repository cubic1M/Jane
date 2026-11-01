import Link from "next/link";
import { Suspense } from "react";
import { AppHeader, PageLoading } from "@/components/app-header";
import { previousMonth } from "@/insights/check-in";
import { loadCheckIn, summaryFor } from "@/lib/check-in";
import { formatCents } from "@/lib/money";
import { loadClose, type CloseView } from "@/lib/month-close";
import { storedReport } from "@/lib/monthly-report-store";
import { requireUser } from "@/lib/session";
import { timezoneOf, todayOf } from "@/lib/today";
import { categoryWords } from "@/planning/month-close";
import { reportLines } from "@/planning/monthly-report";
import { momentLabel, monthLabel } from "@/lib/day-label";

// The month's one report (spec step 148), with the monthly check-in folded in (spec step 45;
// docs/feature-audit.md, cluster 2). For any month: Jane's short summary, what was spent and
// came in, net worth, budgets kept and the biggest changes, worked out from the same loader the
// check-in used. For a month whose report was made: the report as kept then (saved, paid down,
// moved, health, what's next), each figure with a link to the page it comes from, and every
// receipt. /check-in redirects here.

const MONTH = /^\d{4}-\d{2}$/;
const MUTED = "text-zinc-600 dark:text-zinc-400";
const LINK = "text-sm font-medium text-emerald-700 hover:underline";
// Shown as the tiles and sections at the top of the page, so not repeated from the report.
const SHOWN_ABOVE = new Set(["Spent", "Earned", "Net worth", "Budgets"]);

const signed = (cents: number) => `${cents >= 0 ? "up" : "down"} ${formatCents(Math.abs(cents))}`;
const monthAfter = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
};

async function MonthlyContent({
  searchParams,
}: {
  searchParams: PageProps<"/monthly">["searchParams"];
}) {
  const user = await requireUser();
  const { m } = await searchParams;
  const latest = previousMonth(await todayOf(user.id));
  const asked = typeof m === "string" && MONTH.test(m) && m <= latest ? m : null;
  // With no month asked for, the newest report made, or else the month just ended.
  const [stored, timezone] = await Promise.all([storedReport(user.id, asked), timezoneOf(user.id)]);
  const month = asked ?? stored?.month ?? latest;
  const report = stored?.month === month ? stored.report : null;
  const [checkIn, close] = await Promise.all([
    loadCheckIn(user.id, month),
    // Spec step 244: the month as Jane closed it (or is closing it).
    loadClose(user.id, { month }),
  ]);
  const summary = report?.summary ?? (await summaryFor(user.id, checkIn));
  const before = previousMonth(`${month}-01`);
  const after = month < latest ? monthAfter(month) : null;

  return (
    <>
      <AppHeader user={user} />
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">
          {monthLabel(month, { long: true })} money report
        </h1>
        <p className="text-lg">{summary}</p>
        <p className={MUTED}>
          {stored && report
            ? `Made ${momentLabel(stored.createdAt, timezone, { year: true })}. Each figure comes from the page it links to.`
            : month === latest
              ? "Worked out from your accounts now. The full report, with what you saved, paid down and moved, comes in the first days of the month."
              : "Worked out from your accounts now."}
        </p>
        <nav aria-label="Months" className="flex gap-4">
          <Link href={`/monthly?m=${before}`} className={LINK}>
            ‹ {monthLabel(before, { long: true })}
          </Link>
          {after && (
            <Link href={`/monthly?m=${after}`} className={LINK}>
              {monthLabel(after, { long: true })} ›
            </Link>
          )}
        </nav>
      </div>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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

      {close && <MonthClose view={close} timezone={timezone} />}

      {report && (
        <ul className="flex flex-col gap-3">
          {reportLines(report)
            .filter((line) => !SHOWN_ABOVE.has(line.label))
            .map((line) => (
              <li
                key={line.label}
                className="flex flex-col gap-1 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
              >
                <span className="flex flex-wrap items-baseline justify-between gap-x-4">
                  <span className="font-semibold">{line.label}</span>
                  {!line.href.startsWith("/monthly") && (
                    <Link href={line.href} className={LINK}>
                      See it<span className="sr-only">: {line.label}</span>
                    </Link>
                  )}
                </span>
                <span>{line.text}</span>
              </li>
            ))}
        </ul>
      )}

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
          <h2 className="text-xl font-semibold">
            Biggest changes from {monthLabel(before, { long: true })}
          </h2>
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

      <section className={`flex flex-col gap-1 text-sm ${MUTED}`}>
        <p>
          Jane found {checkIn.found.findings} way{checkIn.found.findings === 1 ? "" : "s"} to save
          this month. Changes finished this month save about {formatCents(checkIn.savedCents)} a
          year.
        </p>
        <p>You paid {formatCents(checkIn.debtPaymentsCents)} toward cards and loans this month.</p>
      </section>

      {report && (
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
      )}
    </>
  );
}

// Spec step 244: the month as Jane closed it. Its figures are kept; only a correction changes them.
function MonthClose({ view, timezone }: { view: CloseView; timezone: string }) {
  const f = view.figures;
  return (
    <section
      id="close"
      className="flex flex-col gap-2 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
    >
      <h2 className="text-xl font-semibold">
        {monthLabel(view.month, { long: true })}: {view.status === "closed" ? "closed" : "closing"}
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
          {f.netWorthNotCounting && (
            <dd className={`col-span-2 ${MUTED}`} data-net-worth-not-counting="">
              {f.netWorthNotCounting}
            </dd>
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
        <p className={MUTED}>
          Updated after your correction on {momentLabel(view.correctedAt, timezone, { year: true })}
          .
        </p>
      )}
    </section>
  );
}

export default function MonthlyPage({ searchParams }: PageProps<"/monthly">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<PageLoading />}>
        <MonthlyContent searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
