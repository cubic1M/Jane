import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { DemoAdviceLabel } from "@/components/demo-advice-label";
import {
  PLAN_TO_AGE,
  RMD_SOURCE,
  SPEND_SOURCE,
  SS_ESTIMATE_SOURCE,
  SS_SOURCE,
} from "@/config/retirement-income";
import { loadRetirementIncome } from "@/lib/investments/retirement-income";
import { formatCents } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { IncomeForm } from "./income-form";

// Income in retirement (spec step 212, demo advice): Social Security at 62, full age and
// 70, required minimum distributions, the order to draw, and a monthly paycheck with how
// long the money lasts. Ranges at the assumed returns, in today's dollars.

const LINK = "font-medium text-emerald-700 hover:underline";
const dollars = (c: number | null) => (c === null ? "" : String(Math.round(c / 100)));

async function Content({
  searchParams,
}: {
  searchParams: PageProps<"/investments/retirement-income">["searchParams"];
}) {
  const user = await requireUser();
  await connection();
  const { done } = await searchParams;
  const v = await loadRetirementIncome(user.id);
  const p = v.paycheck;

  return (
    <>
      <AppHeader user={user} />
      <div className="flex flex-col gap-2">
        <Link href="/investments" className={`text-sm ${LINK}`}>
          ← Investments
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">Income in retirement</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Turning savings into a paycheck: when to claim Social Security, which accounts to draw
          from first, the minimums you must take, and how long the money lasts. In today&apos;s
          dollars, as a range, never a promise.
          {v.age !== null && !v.applies
            ? ` This matters most within 15 years of retiring; you can look now.`
            : ""}
        </p>
      </div>
      {done === "saved" && (
        <p
          role="status"
          className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100"
        >
          Saved.
        </p>
      )}

      {v.advice && p && (
        <section className="flex flex-col gap-2 rounded-xl border border-emerald-300 p-4 dark:border-emerald-800">
          <h2 className="text-xl font-semibold">Your retirement paycheck</h2>
          <p className="text-sm">
            Spending {formatCents(v.spendMonthlyCents)} a month (
            {v.spendFrom === "you" ? "what you told me" : SPEND_SOURCE}), retiring at {v.retireAge}:
            the money would last to about age {Math.min(PLAN_TO_AGE, Math.round(p.lasts.lowAge))}
            {p.lasts.highAge > p.lasts.lowAge + 0.5
              ? ` to ${Math.min(PLAN_TO_AGE, Math.round(p.lasts.highAge))}`
              : ""}{" "}
            (the plan runs to {PLAN_TO_AGE}).{" "}
            {p.lastsToPlan
              ? "That covers the whole plan, even at the low return."
              : "That falls short of the plan at the low return."}
          </p>
          <p className="text-sm">
            The most that lasts to {PLAN_TO_AGE}: {formatCents(p.sustainableMonthly.lowCents)} to{" "}
            {formatCents(p.sustainableMonthly.highCents)} a month before tax, with Social Security
            starting at {v.ss.startAge}. Taxes are estimated at {Math.round(v.taxRate * 100)}% on
            the pre-tax share.
          </p>
          <DemoAdviceLabel />
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold">Social Security</h2>
        {v.ss.options.length === 0 ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Enter your statement&apos;s amount below.
          </p>
        ) : (
          <>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-zinc-500">
                  <th className="font-normal">Start at</th>
                  <th className="text-right font-normal">A month</th>
                  <th className="text-right font-normal">Total by age 85</th>
                </tr>
              </thead>
              <tbody>
                {v.ss.options.map((o) => (
                  <tr key={o.age}>
                    <td>{o.age}</td>
                    <td className="text-right">{formatCents(o.monthlyCents)}</td>
                    <td className="text-right">{formatCents(o.lifetimeToAgeCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-zinc-500">
              {v.ss.source === "statement" ? "From the statement you gave." : SS_ESTIMATE_SOURCE}{" "}
              {SS_SOURCE}.
              {v.ss.breakeven62to67
                ? ` Waiting from 62 to 67 has paid more in total by about age ${v.ss.breakeven62to67}; from 67 to 70, by about ${v.ss.breakeven67to70}.`
                : ""}
            </p>
          </>
        )}
      </section>

      {v.draw.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-xl font-semibold">The order to draw</h2>
          <ol className="list-decimal pl-5 text-sm">
            {v.draw.map((d) => (
              <li key={d.key}>
                {d.label} ({formatCents(d.cents)})
              </li>
            ))}
          </ol>
          {v.taxTuned && v.taxTuned.preTaxCapCents !== null && v.taxTuned.lineCents !== null && (
            <p className="text-sm">
              Tuned for taxes: after taxable accounts, take up to{" "}
              {formatCents(v.taxTuned.preTaxCapCents)} from pre-tax accounts this year, which keeps
              your income under {formatCents(v.taxTuned.lineCents)}, the line where Medicare&apos;s
              premiums go up in {v.taxTuned.premiumYear}
              {v.taxTuned.linesEstimated ? " (estimated)" : ""}; then Roth.
              {v.taxTuned.ssTaxableCents > 0
                ? ` ${formatCents(v.taxTuned.ssTaxableCents)} of your Social Security is taxable, so your next pre-tax dollar is taxed at about ${Math.round(v.taxTuned.nextDollarRate * 100)}%.`
                : ""}
            </p>
          )}
        </section>
      )}

      {v.rmd && (
        <section className="flex flex-col gap-1 text-sm">
          <h2 className="text-xl font-semibold">Required minimum distributions</h2>
          <p>
            You must start taking money out of pre-tax accounts at {v.rmd.startAge}.
            {v.rmd.firstYearCents !== null
              ? ` On today's pre-tax balance of ${formatCents(v.balances.preTaxCents)}, the first year's minimum would be about ${formatCents(v.rmd.firstYearCents)}.`
              : ""}{" "}
            <span className="text-xs text-zinc-500">{RMD_SOURCE}.</span>
          </p>
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold">What you tell me</h2>
        <IncomeForm
          initial={{
            ssMonthly: dollars(v.inputs.ssMonthlyCents),
            retireAge: v.inputs.retireAge === null ? "" : String(v.inputs.retireAge),
            ssStartAge: v.inputs.ssStartAge === null ? "" : String(v.inputs.ssStartAge),
            spendMonthly: dollars(v.inputs.spendMonthlyCents),
          }}
        />
      </section>
    </>
  );
}

export default function RetirementIncomePage(props: PageProps<"/investments/retirement-income">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <Content searchParams={props.searchParams} />
      </Suspense>
    </main>
  );
}
