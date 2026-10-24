import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { DemoAdviceLabel } from "@/components/demo-advice-label";
import { SimulatedBanner } from "@/components/simulated-banner";
import { DETECTOR_RATES } from "@/config/detectors";
import { LOOKUP_HELP, ROLLOVER_NOTE } from "@/config/old-accounts";
import { loadOldAccounts } from "@/lib/investments/old-accounts";
import { formatCents } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { addEmployer, answer, rollOver } from "./actions";
import { SubmitButton } from "@/components/submit-button";
import { LoadingBar } from "@/components/loading-bar";

// Old accounts brought home (spec step 211, demo advice): past employers, each asked about
// once; found plans with fees compared; a direct rollover tracked step by step.

const OLD_PLAN_FEE_GAP_PERCENT = DETECTOR_RATES.oldPlanFeeGapBps / 100;
const LINK = "font-medium text-emerald-700 hover:underline";
const BUTTON = "h-11 rounded-lg bg-emerald-700 px-5 font-medium text-white hover:bg-emerald-800";
const SECONDARY =
  "h-11 rounded-lg border border-zinc-300 px-5 font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900";
const DONE: Record<string, string> = {
  started: "Rollover requested. The old plan sends it directly; you'll see each step below.",
  changed: "That changed since you last looked. Here's where it stands.",
};
const day = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

async function Content({
  searchParams,
}: {
  searchParams: PageProps<"/investments/old-accounts">["searchParams"];
}) {
  const user = await requireUser();
  await connection();
  const { done } = await searchParams;
  const v = await loadOldAccounts(user.id);

  return (
    <>
      <AppHeader user={user} />
      <div className="flex flex-col gap-2">
        <Link href="/investments" className={`text-sm ${LINK}`}>
          ← Investments
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">Old accounts</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          A 401(k) left at an old employer is easy to forget and often costs more. Tell me where
          you&apos;ve worked and I&apos;ll ask once about each.
        </p>
      </div>
      {typeof done === "string" && Object.hasOwn(DONE, done) && (
        <p
          role="status"
          className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100"
        >
          {DONE[done]}
        </p>
      )}

      {v.linked && v.linked.plans.length > 0 && (
        <section
          aria-labelledby="linked-old-plans"
          className="flex flex-col gap-2 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
        >
          <h2 id="linked-old-plans" className="text-xl font-semibold">
            Already linked from past jobs
          </h2>
          <ul className="flex flex-col gap-1 text-sm">
            {v.linked.plans.map((p) => (
              <li key={p.id}>
                {p.name}: {formatCents(p.balanceCents)}
              </li>
            ))}
          </ul>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {`You have ${v.linked.count} 401(k) accounts; ${formatCents(v.linked.totalCents)} sits in the older one${v.linked.plans.length > 1 ? "s" : ""}. Old plans often cost about ${OLD_PLAN_FEE_GAP_PERCENT}% a year more, so rolling it into an IRA (moved directly, never withdrawn) saves about ${formatCents(v.linked.savedCents)} a year.`}
          </p>
        </section>
      )}
      {v.plans.length === 0 && (
        <p className="text-zinc-600 dark:text-zinc-400">No past employers yet. Add one below.</p>
      )}
      {v.plans.map((p) => (
        <section
          key={p.id}
          className="flex flex-col gap-2 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
        >
          <h2 className="text-xl font-semibold">{p.employer}</h2>
          {p.status === "asked" && (
            <form action={answer} className="flex flex-wrap items-center gap-3">
              <input type="hidden" name="id" value={p.id} />
              <span className="text-sm">Did you have a 401(k) at {p.employer}?</span>
              <SubmitButton name="had" value="yes" className={BUTTON}>
                Yes
              </SubmitButton>
              <SubmitButton name="had" value="no" className={SECONDARY}>
                No
              </SubmitButton>
            </form>
          )}
          {p.status === "no_plan" && (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">No plan there.</p>
          )}
          {p.status === "not_found" && (
            <div className="text-sm">
              <p>I couldn&apos;t find it. Ways to look:</p>
              <ul className="list-disc pl-5">
                {LOOKUP_HELP.map((h) => (
                  <li key={h}>{h}</li>
                ))}
              </ul>
            </div>
          )}
          {(p.status === "found" || p.status === "rolling" || p.status === "rolled") &&
            p.balanceCents !== null && (
              <p className="text-sm">
                {p.planName}: {formatCents(p.balanceCents)} (read-only until you roll it over).
              </p>
            )}
          {p.fees && p.status === "found" && v.advice && (
            <div className="flex flex-col gap-2">
              <p className="text-sm">
                It costs about {formatCents(p.fees.beforeCents)} a year in fees. In a low-cost index
                fund the same money would cost about {formatCents(p.fees.afterCents)}:{" "}
                {formatCents(p.fees.savedCents)} a year less.
              </p>
              <p className="text-xs text-zinc-500">{ROLLOVER_NOTE}</p>
              <form action={rollOver} className="flex flex-col gap-2">
                <input type="hidden" name="id" value={p.id} />
                <SimulatedBanner />
                <SubmitButton className={`${BUTTON} self-start`}>Roll it over</SubmitButton>
              </form>
              <DemoAdviceLabel />
            </div>
          )}
          {p.steps.length > 0 && (
            <ol className="flex flex-col gap-1 text-sm">
              {p.steps.map((s) => (
                <li key={s.key}>
                  {s.doneOn ? "Done" : "To do"}: {s.label}
                  {s.doneOn
                    ? ` (${day(s.doneOn)})`
                    : p.arrivesOn && s.key === "arrives"
                      ? ` (due ${day(p.arrivesOn)})`
                      : ""}
                </li>
              ))}
            </ol>
          )}
          {p.status === "rolled" && p.fees && (
            <p className="text-sm">
              Done. Fees went from about {formatCents(p.fees.beforeCents)} to about{" "}
              {formatCents(p.fees.afterCents)} a year. This was a transfer, not a withdrawal.
            </p>
          )}
        </section>
      ))}

      <form action={addEmployer} className="flex flex-wrap items-end gap-3">
        <label htmlFor="employer" className="flex flex-col gap-1 text-sm font-medium">
          A past employer
          <input
            id="employer"
            name="employer"
            className="h-11 rounded-lg border border-zinc-300 bg-transparent px-3 text-base dark:border-zinc-700"
          />
        </label>
        <SubmitButton className={SECONDARY}>Add</SubmitButton>
      </form>
    </>
  );
}

export default function OldAccountsPage(props: PageProps<"/investments/old-accounts">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<LoadingBar />}>
        <Content searchParams={props.searchParams} />
      </Suspense>
    </main>
  );
}
