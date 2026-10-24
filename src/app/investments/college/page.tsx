import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { DemoAdviceLabel } from "@/components/demo-advice-label";
import {
  COLLEGE_COST_GROWTH,
  COLLEGE_COST_SOURCE,
  COLLEGE_RETURN,
  COLLEGE_TYPES,
  PLANS_529_SOURCE,
  STATE_529_SOURCE,
} from "@/config/college";
import { loadCollege } from "@/lib/investments/college";
import { formatCents } from "@/lib/money";
import { requireUser } from "@/lib/session";
import type { Range } from "@/planning/college";
import { CollegeForm } from "./college-form";
import { LoadingBar } from "@/components/loading-bar";

// College savings (spec step 158, demo advice): what college could cost, what to put aside
// a month, which 529 plan comes out ahead with the state's tax break, set up as a goal.

const LINK = "font-medium text-emerald-700 hover:underline";
const span = (r: Range) => `${formatCents(r.lowCents)} to ${formatCents(r.highCents)}`;
const pct = (n: number) => `${Math.round(n * 100)}%`;

async function CollegeContent({
  searchParams,
}: {
  searchParams: PageProps<"/investments/college">["searchParams"];
}) {
  const user = await requireUser();
  await connection();
  const { saved } = await searchParams;
  const data = await loadCollege(user.id);

  return (
    <>
      <AppHeader user={user} />
      <div className="flex flex-col gap-2">
        <Link href="/investments" className={`text-sm ${LINK}`}>
          ← Investments
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">College savings</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          What college could cost when they start, what to put aside a month, and the 529 plan that
          comes out ahead. Ranges, never promises.
        </p>
      </div>
      {saved && (
        <p
          role="status"
          className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100"
        >
          Saved as a goal. Jane invests for it with your other goals.
        </p>
      )}
      {!data.advice ? (
        <p className="text-zinc-600 dark:text-zinc-400">
          College savings plans are only in demo advice mode for now.
        </p>
      ) : (
        <>
          {data.plans.map((p) => (
            <section
              key={p.id}
              className="flex flex-col gap-2 rounded-xl border border-amber-300 p-4 dark:border-amber-800"
            >
              <h2 className="text-xl font-semibold">
                {p.childName}, {p.age}
              </h2>
              <p className="text-sm">
                {COLLEGE_TYPES[p.type]}, starting in {p.estimate.years} years: about{" "}
                <strong>{span(p.estimate.cost)}</strong> for four years. Put aside about{" "}
                <strong>{span(p.estimate.monthly)}</strong> a month.
              </p>
              <ul className="flex flex-col gap-1 text-sm">
                {p.estimate.plans.map((c, i) => (
                  <li key={c.plan.key}>
                    {i === 0 ? <strong>{c.plan.name}</strong> : c.plan.name}: fees about{" "}
                    {formatCents(c.feeCents)} a year
                    {c.benefitCents > 0
                      ? `, state tax break about ${formatCents(c.benefitCents)} a year`
                      : ""}
                    . <span className="text-zinc-500">{c.plan.note}.</span>
                  </li>
                ))}
              </ul>
              <DemoAdviceLabel />
            </section>
          ))}
          <section className="flex flex-col gap-2">
            <h2 className="text-xl font-semibold">
              {data.plans.length > 0 ? "Another child" : "Start saving"}
            </h2>
            <CollegeForm />
            {!data.state && (
              <p className="text-xs text-zinc-500">
                Add your state on your{" "}
                <Link href="/taxes/profile" className={LINK}>
                  tax profile
                </Link>{" "}
                to see its 529 tax break.
              </p>
            )}
          </section>
        </>
      )}
      <p className="text-xs text-zinc-500">
        Costs: {COLLEGE_COST_SOURCE}, growing {pct(COLLEGE_COST_GROWTH.low)}–
        {pct(COLLEGE_COST_GROWTH.high)} a year. Returns {pct(COLLEGE_RETURN.low)}–
        {pct(COLLEGE_RETURN.high)} a year. Plans: {PLANS_529_SOURCE}. State breaks:{" "}
        {STATE_529_SOURCE}.
      </p>
    </>
  );
}

export default function CollegePage(props: PageProps<"/investments/college">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<LoadingBar />}>
        <CollegeContent searchParams={props.searchParams} />
      </Suspense>
    </main>
  );
}
