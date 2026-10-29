import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppHeader, PageLoading } from "@/components/app-header";
import { DemoAdviceLabel } from "@/components/demo-advice-label";
import { SimulatedBanner } from "@/components/simulated-banner";
import type { MixShare } from "@/insights/rebalance";
import { loadRebalance, recentOrders } from "@/lib/investments/rebalance";
import { formatCents } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { RebalanceButton } from "./rebalance-button";
import { formatPercent as pct } from "@/lib/percent";

// Rebalance with one tap (spec step 133): the orders that move each account to the target
// mix, the mix before and after, and the confirmations. Orders go to the simulated
// brokerage, and the page says so first.

const LINK = "font-medium text-emerald-700 hover:underline";
const signed = (cents: number) =>
  cents < 0 ? `a loss of ${formatCents(-cents)}` : `a gain of ${formatCents(cents)}`;

function MixTable({ caption, rows }: { caption: string; rows: MixShare[] }) {
  return (
    <table className="w-full text-sm">
      <caption className="text-left font-medium">{caption}</caption>
      <thead>
        <tr className="text-left text-zinc-500">
          <th className="font-normal">Kind</th>
          <th className="text-right font-normal">Share</th>
          <th className="text-right font-normal">Target</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.assetClass}>
            <td>{r.label}</td>
            <td className="text-right">{pct(r.share)}</td>
            <td className="text-right">{pct(r.target)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

async function RebalanceContent({
  searchParams,
}: {
  searchParams: PageProps<"/investments/rebalance">["searchParams"];
}) {
  const user = await requireUser();
  await connection();
  const { done } = await searchParams;
  const [{ advice, plan }, orders] = await Promise.all([
    loadRebalance(user.id),
    recentOrders(user.id),
  ]);

  return (
    <>
      <AppHeader user={user} />
      <div className="flex flex-col gap-2">
        <Link href="/investments" className={`text-sm ${LINK}`}>
          ← Investments
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">Rebalance</h1>
      </div>
      <SimulatedBanner />

      {done && (
        <p
          role="status"
          className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100"
        >
          Done: your orders were filled in the simulation. Your holdings show the new mix.
        </p>
      )}

      {!advice ? (
        <p className="text-zinc-600 dark:text-zinc-400">
          Trading is only in demo advice mode for now.
        </p>
      ) : !plan ? (
        <p className="text-zinc-600 dark:text-zinc-400">
          First, four quick questions about what the money is for.{" "}
          <Link href="/investments/profile" className={LINK}>
            Answer them
          </Link>
          .
        </p>
      ) : plan.before.every((m) => m.share === 0) ? (
        <p className="text-sm">
          You don&apos;t have any investments to rebalance yet. Once money is in an investment or
          retirement account, Jane keeps it at your mix.
        </p>
      ) : plan.orders.length === 0 ? (
        <p className="text-sm">Your mix is on target: nothing to trade.</p>
      ) : (
        <section className="flex flex-col gap-4 rounded-xl border border-amber-300 p-4 dark:border-amber-800">
          <h2 className="text-xl font-semibold">The orders</h2>
          <ul className="flex flex-col gap-2 text-sm">
            {plan.orders.map((o) => (
              <li
                key={`${o.accountId}-${o.ticker}-${o.side}`}
                className="flex flex-wrap justify-between gap-2"
              >
                <span>
                  <strong>{o.side === "sell" ? "Sell" : "Buy"}</strong> {o.name}{" "}
                  <span className="text-zinc-500">({o.accountName})</span>
                  {o.gainCents !== null && (
                    <span className="block text-xs text-zinc-500">
                      Realises about {signed(o.gainCents)} (estimate)
                    </span>
                  )}
                </span>
                <span>{formatCents(o.amountCents)}</span>
              </li>
            ))}
          </ul>
          <div className="grid gap-4 sm:grid-cols-2">
            <MixTable caption="Before" rows={plan.before} />
            <MixTable caption="After" rows={plan.after} />
          </div>
          {plan.realisedGainCents !== 0 && (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              In your taxable account the sales realise about {signed(plan.realisedGainCents)} in
              all, an estimate from your cost basis. Losses are sold first.
            </p>
          )}
          <RebalanceButton planKey={plan.key} />
          <DemoAdviceLabel />
        </section>
      )}

      {orders.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-xl font-semibold">Orders and confirmations</h2>
          <ul className="flex flex-col gap-1 text-sm">
            {orders.map((o) => (
              <li key={o.id} className="flex flex-wrap justify-between gap-2">
                <span>
                  {o.side === "sell" ? "Sold" : "Bought"} {o.securityName}{" "}
                  <span className="text-zinc-500">
                    ({o.account.name}) · {o.status}
                    {o.confirmation ? ` · ${o.confirmation}` : ""} ·{" "}
                    {o.partner === "simulated" ? "simulated" : o.partner}
                  </span>
                </span>
                <span>{formatCents(o.amountCents)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

export default function RebalancePage(props: PageProps<"/investments/rebalance">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<PageLoading />}>
        <RebalanceContent searchParams={props.searchParams} />
      </Suspense>
    </main>
  );
}
