import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppHeader, PageLoading } from "@/components/app-header";
import { DemoAdviceLabel } from "@/components/demo-advice-label";
import { CREDIT_GOAL_KINDS, CREDIT_GOAL_LABELS, CREDIT_GOAL_SOURCE } from "@/config/credit-goals";
import { loadCreditGoals, planFor, type GoalView } from "@/lib/credit-goals";
import { ESTIMATE_NOTE } from "@/lib/jane-agent/credit-goal-replies";
import { formatCents } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { endGoalAction, startGoalAction, tickItemAction } from "./actions";
import { SubmitButton } from "@/components/submit-button";

// A credit score for a goal (spec step 227): the score and date needed, a month-by-month plan
// from the score simulator, and each month's checklist. A stand-in score; every figure is an
// estimate, labelled. Demo advice.

const LINK = "font-medium text-emerald-700 hover:underline";
const INPUT =
  "h-11 w-full rounded-lg border border-zinc-300 bg-transparent px-3 dark:border-zinc-700";
const BUTTON = "h-11 rounded-full bg-emerald-700 px-5 font-medium text-white hover:bg-emerald-800";

function Plan({ g }: { g: GoalView }) {
  return (
    <table aria-label="Plan by month" className="w-full text-left text-sm">
      <thead>
        <tr className="text-zinc-600 dark:text-zinc-400">
          <th className="py-1 font-medium">Month</th>
          <th className="py-1 font-medium">Pay down</th>
          <th className="py-1 font-medium">Estimated score</th>
        </tr>
      </thead>
      <tbody>
        {g.plan.months.map((m) => (
          <tr key={m.month} className="border-t border-zinc-200 dark:border-zinc-800">
            <td className="py-1">{m.month}</td>
            <td className="py-1">{m.payCents > 0 ? formatCents(m.payCents) : "–"}</td>
            <td className="py-1">{m.projectedScore}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

async function GoalContent({ searchParams }: Pick<PageProps<"/loans/goal">, "searchParams">) {
  const user = await requireUser();
  await connection();
  const raw = await searchParams;
  const p = (k: string) => (Array.isArray(raw[k]) ? raw[k]?.[0] : (raw[k] as string | undefined));
  const data = await loadCreditGoals(user.id);
  const score = Number(p("score"));
  const date = p("date");
  const preview =
    data.available && score >= 500 && score <= 850 && date && /^\d{4}-\d{2}-\d{2}$/.test(date)
      ? await planFor(user.id, {
          kind: (CREDIT_GOAL_KINDS as readonly string[]).includes(p("kind") ?? "")
            ? (p("kind") as "mortgage")
            : "other",
          targetScore: score,
          targetDate: date,
        })
      : null;
  return (
    <>
      <AppHeader user={user} />
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">A credit score for a goal</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Tell Jane the score you need and by when, and Jane plans it month by month from the score
          simulator.
        </p>
      </div>
      {!data.available ? (
        <p className="text-zinc-600 dark:text-zinc-400">
          Planning a score needs a credit partner, and there isn&apos;t one for your accounts yet.{" "}
          <Link href="/loans" className={LINK}>
            See every debt
          </Link>
        </p>
      ) : (
        <>
          <DemoAdviceLabel />
          <p
            role="note"
            className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100"
          >
            {ESTIMATE_NOTE}
          </p>
          {p("started") && (
            <p role="status" className="text-sm text-emerald-800 dark:text-emerald-200">
              Plan started.
            </p>
          )}
          {p("ticked") && (
            <p role="status" className="text-sm text-emerald-800 dark:text-emerald-200">
              Ticked off.
            </p>
          )}
          {p("ended") && (
            <p role="status" className="text-sm text-emerald-800 dark:text-emerald-200">
              Plan ended.
            </p>
          )}
          {p("error") && (
            <p role="alert" className="text-sm text-red-700 dark:text-red-300">
              {p("error")}
            </p>
          )}
          <p className="text-sm">Your score now: {data.scoreNow ?? "not pulled yet"}.</p>
          {data.goals.map((g) => (
            <section
              key={g.id}
              aria-label={g.title}
              className="flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
            >
              <h2 className="text-xl font-semibold">{g.title}</h2>
              <p
                className={
                  g.plan.reaches
                    ? "text-emerald-800 dark:text-emerald-200"
                    : "text-amber-800 dark:text-amber-300"
                }
              >
                {g.plan.reaches
                  ? `On the simulator the plan reaches about ${g.plan.endScore}.`
                  : `The best the simulator shows is about ${g.plan.best}: the target isn't reachable by then.`}
              </p>
              <Plan g={g} />
              <div className="flex flex-col gap-2 text-sm">
                <h3 className="font-medium">This month ({g.currentMonth})</h3>
                <ul aria-label="This month's list" className="flex flex-col gap-2">
                  {g.thisMonth.map((i) => (
                    <li key={i.key} className="flex flex-wrap items-center gap-3">
                      <span className={i.done ? "text-zinc-500 line-through" : ""}>{i.text}</span>
                      {i.done ? (
                        <span>Done</span>
                      ) : (
                        <form action={tickItemAction}>
                          <input type="hidden" name="goalId" value={g.id ?? ""} />
                          <input type="hidden" name="key" value={i.key} />
                          <SubmitButton className={LINK}>Mark done</SubmitButton>
                        </form>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
              <form action={endGoalAction}>
                <input type="hidden" name="goalId" value={g.id ?? ""} />
                <SubmitButton className={LINK}>End this plan</SubmitButton>
              </form>
            </section>
          ))}
          {preview && (
            <section aria-label="Preview" className="flex flex-col gap-2">
              <h2 className="text-xl font-semibold">{preview.title}</h2>
              <p role="status">
                {preview.plan.reaches
                  ? `Reachable: about ${preview.plan.endScore} by the end.`
                  : `Not reachable: the best is about ${preview.plan.best}.`}
              </p>
              <Plan g={preview} />
            </section>
          )}
          <form
            method="get"
            action="/loans/goal"
            aria-label="Preview a plan"
            className="grid grid-cols-1 gap-3 sm:grid-cols-4"
          >
            <label className="flex flex-col gap-1 text-sm">
              For
              <select name="kind" defaultValue={p("kind") ?? "mortgage"} className={INPUT}>
                {CREDIT_GOAL_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {CREDIT_GOAL_LABELS[k]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Score needed
              <input name="score" inputMode="numeric" defaultValue={p("score")} className={INPUT} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              By
              <input name="date" type="date" defaultValue={p("date")} className={INPUT} />
            </label>
            <button type="submit" className={`${BUTTON} self-end`}>
              Preview the plan
            </button>
          </form>
          {preview && (
            <form action={startGoalAction}>
              <input type="hidden" name="kind" value={preview.kind} />
              <input type="hidden" name="targetScore" value={preview.targetScore} />
              <input type="hidden" name="targetDate" value={preview.targetDate} />
              <SubmitButton className={BUTTON}>Start this plan</SubmitButton>
            </form>
          )}
          <a href={CREDIT_GOAL_SOURCE} className={`${LINK} text-sm`}>
            What makes up a credit score (CFPB)
          </a>
        </>
      )}
    </>
  );
}

export default function GoalPage({ searchParams }: PageProps<"/loans/goal">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<PageLoading />}>
        <GoalContent searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
