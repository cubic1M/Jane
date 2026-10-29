import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppHeader, PageLoading } from "@/components/app-header";
import { DemoAdviceLabel } from "@/components/demo-advice-label";
import { GLIDE_PATH, GLIDE_PATH_SOURCE } from "@/config/investing";
import { loadGoalBuckets } from "@/lib/investments/goal-buckets";
import { formatCents } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { formatPercent as pct } from "@/lib/percent";

// Every goal invested for its timeline (spec step 157, demo advice): each goal's bucket and
// mix, the glide path behind it, and what Jane does with new money.

const LINK = "font-medium text-emerald-700 hover:underline";

async function GoalsContent() {
  const user = await requireUser();
  await connection();
  const { advice, byHerself, buckets } = await loadGoalBuckets(user.id);

  return (
    <>
      <AppHeader user={user} />
      <div className="flex flex-col gap-2">
        <Link href="/investments" className={`text-sm ${LINK}`}>
          ← Investments
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">Invested for each goal</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Money for each goal is invested to match when you need it: cash when it&apos;s close, more
          stocks when it&apos;s far away, safer as the date nears.
        </p>
      </div>

      {!advice ? (
        <p className="text-zinc-600 dark:text-zinc-400">
          Investing by goal is only in demo advice mode for now.
        </p>
      ) : !buckets ? (
        <p className="text-zinc-600 dark:text-zinc-400">
          First, four quick questions about what the money is for.{" "}
          <Link href="/investments/profile" className={LINK}>
            Answer them
          </Link>
          .
        </p>
      ) : buckets.length === 0 ? (
        <p className="text-zinc-600 dark:text-zinc-400">
          No goals with a date yet.{" "}
          <Link href="/goals" className={LINK}>
            Add a goal
          </Link>{" "}
          and Jane invests for it.
        </p>
      ) : (
        <section className="flex flex-col gap-3 rounded-xl border border-amber-300 p-4 dark:border-amber-800">
          <h2 className="text-xl font-semibold">Your goals</h2>
          <ul className="flex flex-col gap-3 text-sm">
            {buckets.map((b) => (
              <li key={b.id} className="flex flex-col gap-1">
                <span className="flex flex-wrap justify-between gap-2">
                  <strong>{b.name}</strong>
                  <span>
                    {pct(b.mix.us_stocks + b.mix.intl_stocks)} stocks · {pct(b.mix.bonds)} bonds ·{" "}
                    {pct(b.mix.cash)} cash
                  </span>
                </span>
                <span className="text-zinc-600 dark:text-zinc-400">
                  {b.why}
                  {b.monthlyCents > 0 && ` Needs about ${formatCents(b.monthlyCents)} a month.`}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-sm">
            {byHerself
              ? "New money from automatic investing goes to each goal by itself: near-term goals first, kept in cash."
              : "On “Ask me first”, automatic investing uses your one mix. Choose “Handle the safe stuff” in Settings and Jane splits new money by goal on its own."}
          </p>
          <DemoAdviceLabel />
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold">The glide path</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-zinc-500">
              <th className="font-normal">Years until you need it</th>
              <th className="text-right font-normal">Stocks</th>
              <th className="text-right font-normal">Bonds</th>
              <th className="text-right font-normal">Cash</th>
            </tr>
          </thead>
          <tbody>
            {GLIDE_PATH.map((g, i) => (
              <tr key={g.fromYears}>
                <td>
                  {i === 0
                    ? `${g.fromYears} or more`
                    : `${g.fromYears} to ${GLIDE_PATH[i - 1].fromYears}`}
                </td>
                <td className="text-right">{pct(g.stocks)}</td>
                <td className="text-right">{pct(g.bonds)}</td>
                <td className="text-right">{pct(g.cash)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-xs text-zinc-500">
          Stocks never go above what your risk level allows. {GLIDE_PATH_SOURCE}.
        </p>
      </section>
    </>
  );
}

export default function GoalsInvestedPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<PageLoading />}>
        <GoalsContent />
      </Suspense>
    </main>
  );
}
