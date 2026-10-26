import { connection } from "next/server";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { BUDGET_SUGGESTION_MONTHS } from "@/config/budgets";
import { budgetSummary } from "@/insights/budgets";
import type { IrregularItem } from "@/insights/irregular";
import { loadInsightTransactions } from "@/insights/load";
import { BUDGET_CATEGORIES } from "@/lib/budgets";
import { scopedDb } from "@/lib/db-scoped";
import { irregularCosts } from "@/lib/irregular";
import { formatCents } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { deleteBudget } from "./actions";
import { BudgetForm } from "./budget-form";
import { SubmitButton } from "@/components/submit-button";
import { LoadingBar } from "@/components/loading-bar";
import { ProgressBar } from "@/components/progress-bar";

const HOW_OFTEN: Record<IrregularItem["frequency"], string> = {
  QUARTERLY: "Every 3 months",
  SEMIANNUALLY: "Twice a year",
  ANNUALLY: "Once a year",
};

const longDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

async function Budgets() {
  await connection();
  const user = await requireUser();
  const db = await scopedDb();
  const now = new Date();
  const asOf = now.toISOString().slice(0, 10);
  const [transactions, budgets, irregular] = await Promise.all([
    loadInsightTransactions(db, asOf, BUDGET_SUGGESTION_MONTHS + 1),
    db.budgets.findMany({ select: { category: true, amountCents: true } }),
    irregularCosts(user.id, { now }),
  ]);
  const summary = budgetSummary(transactions, budgets, asOf);

  return (
    <>
      <AppHeader user={user} />
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
                <ProgressBar
                  label={`${p.category} budget used`}
                  percent={share}
                  fill={p.over ? "over" : "good"}
                />
                <form action={deleteBudget} className="self-end">
                  <input type="hidden" name="category" value={p.category} />
                  <SubmitButton className="text-xs text-zinc-500 hover:text-red-700 hover:underline">
                    Remove
                  </SubmitButton>
                </form>
              </li>
            );
          })}
        </ul>
      )}

      {irregular.items.length > 0 && (
        // Spec step 70: yearly and irregular bills, as a monthly amount to set aside. The
        // Ahead hub links here (spec step 80).
        <section id="yearly" className="flex scroll-mt-4 flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-xl font-semibold">Set aside for yearly bills</h2>
            <span className="font-semibold">{formatCents(irregular.monthlyCents)} a month</span>
          </div>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Bills that come less often than monthly, and seasons when you usually spend more, spread
            over the year: {formatCents(irregular.yearlyCents)} a year in all. Safe to spend on Home
            already takes this month&apos;s share off. Math from your data, not a recommendation.
          </p>
          <ul className="flex flex-col gap-3">
            {irregular.items.map((item) => (
              <li
                key={item.key}
                className="flex flex-col gap-1 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="font-semibold">{item.name}</h3>
                  <span className="text-sm">{formatCents(item.monthlyCents)} a month</span>
                </div>
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  {item.kind === "seasonal"
                    ? `Each year, above your usual month: ${formatCents(item.yearlyCents)}.`
                    : `${HOW_OFTEN[item.frequency]}, ${formatCents(item.yearlyCents)} a year.`}{" "}
                  Next about {longDate(item.nextDate)}, around {formatCents(item.nextAmountCents)}.
                </p>
                <p className="text-sm">
                  By now: {formatCents(item.byNowCents)} of {formatCents(item.nextAmountCents)} set
                  aside for it.
                </p>
              </li>
            ))}
          </ul>
        </section>
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
      <Suspense fallback={<LoadingBar />}>
        <Budgets />
      </Suspense>
    </main>
  );
}
