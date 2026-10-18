import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { BUDGET_SUGGESTION_MONTHS } from "@/config/budgets";
import { budgetSummary } from "@/insights/budgets";
import { loadInsightTransactions } from "@/insights/load";
import { BUDGET_CATEGORIES } from "@/lib/budgets";
import { scopedDb } from "@/lib/db-scoped";
import { formatCents } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { deleteBudget } from "./actions";
import { BudgetForm } from "./budget-form";

async function Budgets() {
  const user = await requireUser();
  const db = await scopedDb();
  const asOf = new Date().toISOString().slice(0, 10);
  const [transactions, budgets] = await Promise.all([
    loadInsightTransactions(db, asOf, BUDGET_SUGGESTION_MONTHS + 1),
    db.budgets.findMany({ select: { category: true, amountCents: true } }),
  ]);
  const summary = budgetSummary(transactions, budgets, asOf);

  return (
    <>
      <AppHeader email={user.email} />
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Budgets</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          A monthly limit for any category you choose. Spending is counted the same way as on
          Insights. {summary.daysLeft} day{summary.daysLeft === 1 ? "" : "s"} left this month.
        </p>
      </div>

      {summary.progress.length > 0 && (
        <ul className="flex flex-col gap-3">
          {summary.progress.map((p) => {
            const share = Math.min(100, Math.round((p.spentCents / p.budgetCents) * 100));
            return (
              <li
                key={p.category}
                className="flex flex-col gap-2 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="font-semibold">{p.category}</h2>
                  <span
                    className={`text-sm ${p.over ? "font-semibold text-red-700" : "text-zinc-600 dark:text-zinc-400"}`}
                  >
                    {formatCents(p.spentCents)} of {formatCents(p.budgetCents)}
                    {p.over
                      ? `, ${formatCents(-p.leftCents)} over`
                      : `, ${formatCents(p.leftCents)} left`}
                  </span>
                </div>
                <div
                  role="progressbar"
                  aria-label={`${p.category} budget used`}
                  aria-valuenow={share}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  className="h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"
                >
                  <div
                    className={`h-full ${p.over ? "bg-red-600" : "bg-emerald-600"}`}
                    style={{ width: `${share}%` }}
                  />
                </div>
                <form action={deleteBudget} className="self-end">
                  <input type="hidden" name="category" value={p.category} />
                  <button
                    type="submit"
                    className="text-xs text-zinc-500 hover:text-red-700 hover:underline"
                  >
                    Remove
                  </button>
                </form>
              </li>
            );
          })}
        </ul>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">
          {summary.progress.length > 0 ? "Add or change a budget" : "Set a budget"}
        </h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          The averages in brackets are your own spending over the last {BUDGET_SUGGESTION_MONTHS}{" "}
          months, as a starting point; pick whatever suits you.
        </p>
        <BudgetForm categories={BUDGET_CATEGORIES} suggestions={summary.suggestions} />
      </section>
    </>
  );
}

export default function BudgetsPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <Budgets />
      </Suspense>
    </main>
  );
}
