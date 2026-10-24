import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { scopedDb } from "@/lib/db-scoped";
import { loadTradeoffs } from "@/lib/goal-tradeoffs";
import { listGoals } from "@/lib/goals";
import { formatCents } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { GOALS_COPY, monthlyLine } from "@/planning/goals-copy";
import { removeGoal } from "./actions";
import { accountLabels } from "@/lib/account-labels";
import { GoalForm } from "./goal-form";
import { GoalTradeoffs } from "./tradeoffs";

const EMPTY = { goalId: "", name: "", target: "", targetDate: "", accountId: "", saved: "" };
const dollars = (cents: number | null) => (cents === null ? "" : (cents / 100).toFixed(2));
const day = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

async function Goals() {
  const user = await requireUser();
  const db = await scopedDb();
  const [goals, accounts, tradeoffs] = await Promise.all([
    listGoals(user.id),
    db.accounts
      .findMany({
        where: { type: "depository" },
        select: { id: true, name: true, mask: true, createdAt: true },
        orderBy: { name: "asc" },
      })
      // Each named so no two read the same.
      .then((rows) => {
        const labels = accountLabels(rows);
        return rows.map((a) => ({ id: a.id, name: labels.get(a.id)! }));
      }),
    // Spec step 241: only worth the year plan's work with two goals or more.
    db.savingsGoals.count().then((n) => (n >= 2 ? loadTradeoffs(user.id) : null)),
  ]);

  return (
    <>
      <AppHeader user={user} />
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Savings goals</h1>
        <p className="text-zinc-600 dark:text-zinc-400">{GOALS_COPY.intro}</p>
      </div>

      {goals.length > 0 && (
        <ul className="flex flex-col gap-3">
          {goals.map((g) => (
            <li
              key={g.id}
              className="flex flex-col gap-2 rounded-xl border border-zinc-200 p-4 [overflow-wrap:anywhere] dark:border-zinc-800"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-semibold">{g.name}</h2>
                <span className="text-sm text-zinc-600 dark:text-zinc-400">
                  {formatCents(g.progress.savedCents)} of {formatCents(g.targetCents)} by{" "}
                  {day(g.targetDate)}
                </span>
              </div>
              <div
                role="progressbar"
                aria-label={`${g.name} progress`}
                aria-valuenow={g.progress.percent}
                aria-valuemin={0}
                aria-valuemax={100}
                className="h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"
              >
                <div
                  className="h-full bg-emerald-600"
                  style={{ width: `${g.progress.percent}%` }}
                />
              </div>
              <p className="text-sm">
                {g.progress.status === "reached"
                  ? GOALS_COPY.reached
                  : g.progress.status === "date_passed"
                    ? GOALS_COPY.datePassed
                    : monthlyLine(formatCents(g.progress.monthlyCents), g.progress.monthsLeft)}
              </p>
              <p className="text-xs text-zinc-500">
                {g.accountName
                  ? `${GOALS_COPY.linkedNote} (${g.accountName})`
                  : GOALS_COPY.manualNote}
              </p>
              <details>
                <summary className="cursor-pointer text-sm text-emerald-700">Edit</summary>
                <div className="mt-3">
                  <GoalForm
                    accounts={accounts}
                    values={{
                      goalId: g.id,
                      name: g.name,
                      target: dollars(g.targetCents),
                      targetDate: g.targetDate,
                      accountId: g.accountName ? (g.accountId ?? "") : "",
                      saved: dollars(g.manualSavedCents),
                    }}
                  />
                </div>
              </details>
              <form action={removeGoal} className="self-end">
                <input type="hidden" name="goalId" value={g.id} />
                <button
                  type="submit"
                  className="text-xs text-zinc-500 hover:text-red-700 hover:underline"
                >
                  Delete goal
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}

      {tradeoffs && <GoalTradeoffs view={tradeoffs} />}

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">Add a goal</h2>
        <GoalForm values={EMPTY} accounts={accounts} />
      </section>

      <p className="rounded-xl bg-zinc-100 p-4 text-sm text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
        {GOALS_COPY.disclaimer}
      </p>
    </>
  );
}

export default function GoalsPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <Goals />
      </Suspense>
    </main>
  );
}
