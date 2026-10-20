import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { DemoAdviceLabel } from "@/components/demo-advice-label";
import { SimulatedBanner } from "@/components/simulated-banner";
import { PLACEMENT_SOURCE } from "@/config/location";
import { loadLocation } from "@/lib/investments/location";
import { formatCents } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { CLASSES } from "@/planning/location";
import { swapNow } from "./actions";

// The right investment in the right account (spec step 231, demo advice): one allocation
// across every account, with the swaps that put the tax-heavy holdings in tax-advantaged
// accounts. The overall mix never changes; a swap that sells at a gain shows its tax.

const LINK = "font-medium text-emerald-700 hover:underline";
const BUTTON = "h-11 rounded-lg bg-emerald-700 px-5 font-medium text-white hover:bg-emerald-800";
const SECONDARY =
  "h-11 rounded-lg border border-zinc-300 px-5 font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900";
const NAMES = {
  bonds: "bonds",
  us_stocks: "US stocks",
  intl_stocks: "international stocks",
} as const;

async function Content({
  searchParams,
}: {
  searchParams: PageProps<"/investments/location">["searchParams"];
}) {
  const user = await requireUser();
  await connection();
  const { done } = await searchParams;
  const v = await loadLocation(user.id);
  const plan = v.plan;
  const free = plan?.swaps.filter((s) => s.taxCents === 0) ?? [];
  return (
    <>
      <AppHeader user={user} />
      <div className="flex flex-col gap-2">
        <Link href="/investments" className={`text-sm ${LINK}`}>
          ← Investments
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">
          The right investment in the right account
        </h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Bond interest is taxed every year in a taxable account; in a 401(k) it isn&apos;t.
          Swapping where bonds and stocks sit saves tax without changing your overall mix.{" "}
          {PLACEMENT_SOURCE}.
        </p>
      </div>
      {(done === "swapped" || done === "changed") && (
        <p
          role="status"
          className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100"
        >
          {done === "swapped"
            ? "Done in the simulated brokerage (no real money moves)."
            : "Your accounts changed since that plan. Here's the new one."}
        </p>
      )}
      {!plan && (
        <p className="text-zinc-600 dark:text-zinc-400">
          You need two or more investment accounts for this.
        </p>
      )}
      {plan && (
        <>
          <section className="flex flex-col gap-2">
            <h2 className="text-xl font-semibold">Your overall mix (it stays the same)</h2>
            <p className="text-sm">
              {CLASSES.map((c) => `${formatCents(plan.totals[c])} ${NAMES[c]}`).join(", ")}.
            </p>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-zinc-500">
                  <th className="font-normal">Account</th>
                  {CLASSES.map((c) => (
                    <th key={c} className="text-right font-normal">
                      {NAMES[c]} now → after
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {v.accounts.map((a) => (
                  <tr key={a.id}>
                    <td>{a.name}</td>
                    {CLASSES.map((c) => (
                      <td key={c} className="text-right">
                        {formatCents(plan.before[a.id][c])} → {formatCents(plan.after[a.id][c])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          {v.advice && plan.swaps.length > 0 && (
            <section className="flex flex-col gap-3 rounded-xl border border-emerald-300 p-4 dark:border-emerald-800">
              <h2 className="text-xl font-semibold">The swaps</h2>
              <p className="text-sm">
                Tax on payouts in taxable accounts: about {formatCents(plan.taxNowCents)} a year
                now, {formatCents(plan.taxAfterCents)} after: {formatCents(plan.savedCents)} a year
                less, at your {Math.round(v.ordinaryRate * 100)}% rate on interest and{" "}
                {Math.round(v.gainRate * 100)}% on dividends
                {v.fromEstimate
                  ? " (from your tax estimate)"
                  : " (assumed; fill in your tax profile for yours)"}
                .
              </p>
              <ul className="flex flex-col gap-2 text-sm">
                {plan.swaps.map((s) => (
                  <li key={s.key} className="flex flex-wrap items-center gap-3">
                    <span>
                      {s.a.accountName}: {NAMES[s.a.sell]} → {NAMES[s.a.buy]}; {s.b.accountName}:{" "}
                      {NAMES[s.b.sell]} → {NAMES[s.b.buy]}, {formatCents(s.amountCents)} each.{" "}
                      {s.taxCents > 0
                        ? `Sells at a gain of ${formatCents(s.gainCents)}: about ${formatCents(s.taxCents)} in tax.`
                        : "No tax."}
                    </span>
                    {s.taxCents > 0 && (
                      <form action={swapNow}>
                        <input type="hidden" name="plan" value={plan.key} />
                        <input type="hidden" name="which" value={s.key} />
                        <button type="submit" className={SECONDARY}>
                          Swap anyway
                        </button>
                      </form>
                    )}
                  </li>
                ))}
              </ul>
              {free.length > 0 && (
                <form action={swapNow} className="flex flex-col gap-2">
                  <input type="hidden" name="plan" value={plan.key} />
                  <input type="hidden" name="which" value="free" />
                  <SimulatedBanner />
                  <button type="submit" className={`${BUTTON} self-start`}>
                    Make the swaps that cost no tax
                  </button>
                </form>
              )}
              <DemoAdviceLabel />
            </section>
          )}
          {v.advice && plan.swaps.length === 0 && (
            <p className="text-sm">Your investments are already in the right accounts for tax.</p>
          )}
        </>
      )}
    </>
  );
}

export default function LocationPage(props: PageProps<"/investments/location">) {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <Content searchParams={props.searchParams} />
      </Suspense>
    </main>
  );
}
