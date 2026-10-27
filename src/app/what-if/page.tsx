import Link from "next/link";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { SCENARIOS, SCENARIO_LABELS } from "@/config/what-if";
import { formatCents } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { isScenario, whatIf } from "@/lib/what-if";
import { LoadingBar } from "@/components/loading-bar";

// What if (spec step 203): pick a scenario, see it month by month and sector by sector,
// with every assumption shown. Nothing here changes anything; "Use this plan" is in the chat.

const MUTED = "text-zinc-600 dark:text-zinc-400";
const LINK = "font-medium text-emerald-700 hover:underline";

async function WhatIfContent({
  searchParams,
}: {
  searchParams: PageProps<"/what-if">["searchParams"];
}) {
  const user = await requireUser();
  const { s } = await searchParams;
  const scenario = isScenario(s) ? s : null;
  const run = scenario ? await whatIf(user.id, scenario) : null;
  return (
    <>
      <AppHeader user={user} />
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">What if</h1>
        <p className={MUTED}>
          Pick something that could happen and see it through your own numbers. Nothing changes
          until you say so in the chat.
        </p>
        <ul className="flex flex-wrap gap-2 text-sm">
          {SCENARIOS.map((id) => (
            <li key={id}>
              <Link
                href={`/what-if?s=${id}`}
                className={`inline-flex min-h-11 items-center rounded-full border px-3 ${id === scenario ? "border-emerald-700 text-emerald-700" : "border-zinc-300 dark:border-zinc-700"}`}
              >
                {SCENARIO_LABELS[id]}
              </Link>
            </li>
          ))}
        </ul>
      </div>
      {scenario && !run && <p className={MUTED}>Add your accounts first, then I can run this.</p>}
      {run && (
        <>
          <section className="flex flex-col gap-2">
            <h2 className="text-xl font-semibold">{run.label}</h2>
            <p>{run.sectors.forecast}</p>
            <ul className="flex flex-col gap-1 text-sm">
              {run.sectors.debt && <li>{run.sectors.debt}</li>}
              {run.sectors.taxes && <li>{run.sectors.taxes}</li>}
              <li>{run.sectors.investing}</li>
              {run.sectors.goals.map((g) => (
                <li key={g.id}>
                  {g.name}: {g.note}
                </li>
              ))}
            </ul>
          </section>
          <section className="flex flex-col gap-2">
            <h2 className="text-xl font-semibold">Month by month</h2>
            <table className="w-full text-sm">
              <thead>
                <tr className={`text-left ${MUTED}`}>
                  <th className="py-1">Month</th>
                  <th>Cash with it</th>
                  <th>Cash without</th>
                </tr>
              </thead>
              <tbody>
                {run.after.rows.map((r, i) => (
                  <tr key={r.month}>
                    <td className="py-1">{r.month}</td>
                    <td>{formatCents(r.balanceCents)}</td>
                    <td>{formatCents(run.before.rows[i].balanceCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <section className="flex flex-col gap-2">
            <h2 className="text-xl font-semibold">My plan</h2>
            <ul className="flex flex-col gap-2 text-sm">
              {run.plan.map((c) => (
                <li key={c.key}>
                  <span className="font-medium">{c.title}.</span>{" "}
                  <span className={MUTED}>{c.detail}</span>
                </li>
              ))}
            </ul>
            <Link href="/chat" className={LINK}>
              Ask Jane to use this plan
            </Link>
          </section>
          <section className={`flex flex-col gap-1 text-sm ${MUTED}`}>
            <h2 className="text-base font-semibold">What I assumed</h2>
            <p>
              Income {run.params.incomeLossShare >= 0 ? "down" : "up"}{" "}
              {Math.abs(Math.round(run.params.incomeLossShare * 100))}%
              {run.params.months > 0 ? ` for ${run.params.months} months` : " for the year"}; extra
              spending {formatCents(run.params.extraMonthlyCents)} a month; one-time{" "}
              {formatCents(run.params.oneTimeCents)}. Cash, income and spending are your recent
              averages.
            </p>
          </section>
        </>
      )}
    </>
  );
}

export default function WhatIfPage({ searchParams }: PageProps<"/what-if">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<LoadingBar />}>
        <WhatIfContent searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
