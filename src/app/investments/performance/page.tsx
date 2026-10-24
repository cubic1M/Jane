import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { BENCHMARK_SOURCE, HONEST_NOTE } from "@/config/returns";
import { formatReturn } from "@/insights/returns";
import { loadHonest } from "@/lib/investments/honest";
import { requireUser } from "@/lib/session";
import { annualized } from "@/planning/honest";
import { LoadingBar } from "@/components/loading-bar";

// Honest performance (spec step 233): how the money really did over 1, 3 and 5 years, after
// fees and taxes, against a simple benchmark mix with the same risk, and why they differ.
// What happened, never what will.

const LINK = "font-medium text-emerald-700 hover:underline";
const points = (p: number) => `${p >= 0 ? "+" : "−"}${Math.abs(p * 100).toFixed(1)} points`;

async function Content() {
  const user = await requireUser();
  await connection();
  const v = await loadHonest(user.id);
  return (
    <>
      <AppHeader user={user} />
      <div className="flex flex-col gap-2">
        <Link href="/investments" className={`text-sm ${LINK}`}>
          ← Investments
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">How your money really did</h1>
        <p className="text-zinc-600 dark:text-zinc-400">{HONEST_NOTE}</p>
      </div>
      {v.rows.length === 0 && (
        <p className="text-zinc-600 dark:text-zinc-400">
          Finish your investor profile so I have a benchmark with the same risk, and link your
          investments.
        </p>
      )}
      {v.rows.map((r) => (
        <section
          key={r.key}
          className="flex flex-col gap-2 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
        >
          <h2 className="text-xl font-semibold">
            {r.label}
            {r.shorter ? ` (${r.from} on: the history is shorter)` : ""}
          </h2>
          <table className="w-full text-sm">
            <tbody>
              <tr>
                <td>Your investments, before fees</td>
                <td className="text-right">{formatReturn(r.beforeFees)}</td>
              </tr>
              <tr>
                <td>After fees</td>
                <td className="text-right">{formatReturn(r.afterFees)}</td>
              </tr>
              <tr>
                <td>After fees and taxes</td>
                <td className="text-right">
                  {formatReturn(r.afterTaxes)} ({formatReturn(annualized(r.afterTaxes, r.years))} a
                  year)
                </td>
              </tr>
              {r.moneyWeighted !== null && (
                <tr>
                  <td>Your money, counting when it went in and out</td>
                  <td className="text-right">{formatReturn(r.moneyWeighted)}</td>
                </tr>
              )}
              <tr>
                <td>A simple mix with your risk level</td>
                <td className="text-right">{formatReturn(r.benchmark)}</td>
              </tr>
              <tr className="font-medium">
                <td>You against it</td>
                <td className="text-right">{points(r.gap)}</td>
              </tr>
            </tbody>
          </table>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">Why:</p>
          <ul className="list-disc pl-5 text-sm">
            {r.reasons.map((x) => (
              <li key={x.key}>
                {x.label}: {points(x.points)}
              </li>
            ))}
          </ul>
        </section>
      ))}
      {v.rows.length > 0 && (
        <p className="text-xs text-zinc-500">
          Benchmark: {BENCHMARK_SOURCE}. Your funds cost about {(v.ownFeeBps / 100).toFixed(2)}% a
          year and tax on payouts about {(v.taxDragBps / 100).toFixed(2)}% a year.
          {v.simulatedPrices ? " Prices are the demo feed's (made up)." : ""}
        </p>
      )}
    </>
  );
}

export default function PerformancePage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<LoadingBar />}>
        <Content />
      </Suspense>
    </main>
  );
}
