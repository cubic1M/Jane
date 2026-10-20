import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { DemoAdviceLabel } from "@/components/demo-advice-label";
import { MORTGAGE_MONEY_SOURCES, RECAST_NOTE } from "@/config/mortgage-money";
import { formatRate } from "@/insights/loans";
import { MortgageMoneyError, loadMortgageMoney } from "@/lib/mortgage-money";
import { formatCents, parseMoneyToCents } from "@/lib/money";
import { requireUser } from "@/lib/session";

// Recast, refinance or pay extra (spec step 246): a lump sum and/or extra money each month used
// three ways on the mortgage, with fees and the date each pays back, against investing it
// instead. A plain GET form; nothing is stored or sent. Demo advice.

const LINK = "font-medium text-emerald-700 hover:underline";
const INPUT =
  "h-11 w-full rounded-lg border border-zinc-300 bg-transparent px-3 dark:border-zinc-700";
const BUTTON = "h-11 rounded-full bg-emerald-700 px-5 font-medium text-white hover:bg-emerald-800";

async function RecastContent({ searchParams }: Pick<PageProps<"/loans/recast">, "searchParams">) {
  const user = await requireUser();
  await connection();
  const raw = await searchParams;
  const p = (k: string) => (Array.isArray(raw[k]) ? raw[k]?.[0] : (raw[k] as string | undefined));
  const money = (k: string) => {
    const v = (p(k) ?? "").trim();
    return v ? (parseMoneyToCents(v) ?? -1) : undefined;
  };
  let error: string | null = null;
  let view = null;
  try {
    view = await loadMortgageMoney(user.id, {
      lumpCents: money("lump"),
      extraMonthlyCents: money("monthly"),
    });
  } catch (e) {
    if (!(e instanceof MortgageMoneyError)) throw e;
    error = e.message;
    view = await loadMortgageMoney(user.id);
  }
  const r = view.result;
  return (
    <>
      <AppHeader user={user} />
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Recast, refinance or pay extra</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          What to do with a lump sum or extra money each month on your mortgage, over the life of
          the loan.
        </p>
      </div>
      {!view.available ? (
        <p className="text-zinc-600 dark:text-zinc-400">
          I don&apos;t see a mortgage with a balance, a rate and an end date.{" "}
          <Link href="/loans" className={LINK}>
            See every debt
          </Link>
        </p>
      ) : !view.advice ? (
        <p className="text-zinc-600 dark:text-zinc-400">
          Comparing ways to use extra money on a mortgage is advice, and Jane only gives it for the
          demo bank.
        </p>
      ) : (
        <>
          <DemoAdviceLabel />
          <p>
            {view.loanName}: {formatCents(view.balanceCents)} left at {formatRate(view.aprBps ?? 0)}
            .
          </p>
          {error && (
            <p role="alert" className="text-sm text-red-700 dark:text-red-300">
              {error}
            </p>
          )}
          <form
            method="get"
            action="/loans/recast"
            aria-label="What you have"
            className="grid gap-3 sm:grid-cols-3"
          >
            <label className="flex flex-col gap-1 text-sm">
              A lump sum
              <input name="lump" inputMode="decimal" defaultValue={p("lump")} className={INPUT} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Extra each month
              <input
                name="monthly"
                inputMode="decimal"
                defaultValue={p("monthly")}
                className={INPUT}
              />
            </label>
            <button type="submit" className={`${BUTTON} self-end`}>
              Compare
            </button>
          </form>
          {r && (
            <>
              <p role="status">
                Doing nothing: {formatCents(r.baseline.paymentCents)} a month, paid off{" "}
                {r.baseline.endsOn}, {formatCents(r.baseline.totalInterestCents)} total interest.
              </p>
              <table aria-label="The ways" className="w-full text-left text-sm">
                <thead>
                  <tr className="text-zinc-600 dark:text-zinc-400">
                    <th className="py-1 font-medium">Way</th>
                    <th className="py-1 font-medium">Payment</th>
                    <th className="py-1 font-medium">Paid off</th>
                    <th className="py-1 font-medium">Total interest</th>
                    <th className="py-1 font-medium">Fee</th>
                    <th className="py-1 font-medium">Fee paid back</th>
                  </tr>
                </thead>
                <tbody>
                  {r.options.map((o) => (
                    <tr key={o.kind} className="border-t border-zinc-200 dark:border-zinc-800">
                      <td className="py-1">{o.label}</td>
                      {o.available ? (
                        <>
                          <td className="py-1">{formatCents(o.paymentCents)}</td>
                          <td className="py-1">{o.endsOn}</td>
                          <td className="py-1">{formatCents(o.totalInterestCents)}</td>
                          <td className="py-1">{o.feeCents ? formatCents(o.feeCents) : "none"}</td>
                          <td className="py-1">{o.breakEvenOn ?? "–"}</td>
                        </>
                      ) : (
                        <td colSpan={5} className="py-1">
                          Not an option: {o.why}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p>
                Investing the same money for {r.invest.years} years instead: a gain of{" "}
                {formatCents(r.invest.lowGainCents)} to {formatCents(r.invest.highGainCents)}, and
                it could land anywhere in or outside that range. Paying down earns your{" "}
                {r.guaranteedReturnPercent}% rate with nothing at stake in the market.
              </p>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">{RECAST_NOTE}</p>
            </>
          )}
          <ul className="flex flex-col gap-1 text-sm">
            {MORTGAGE_MONEY_SOURCES.map((s) => (
              <li key={s.url}>
                <a href={s.url} className={LINK}>
                  {s.label}
                </a>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

export default function RecastPage({ searchParams }: PageProps<"/loans/recast">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <RecastContent searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
