import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { ViewTracker } from "@/components/view-tracker";
import { INSIGHT_MONTHS } from "@/config/insights";
import { BudgetList } from "@/components/budget-list";
import { budgetSummary } from "@/insights/budgets";
import { loadInsightTransactions } from "@/insights/load";
import { spendingInsights } from "@/insights/spending";
import { scopedDb } from "@/lib/db-scoped";
import { formatCents } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { HorizontalBars, MonthBars } from "./bars";

const monthName = (month: string) =>
  new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

async function Insights() {
  const user = await requireUser();
  const db = await scopedDb();
  const asOf = new Date().toISOString().slice(0, 10);
  const transactions = await loadInsightTransactions(db, asOf, INSIGHT_MONTHS);
  if (transactions.length === 0) redirect("/home");

  const insights = spendingInsights(transactions, { asOf, monthCount: INSIGHT_MONTHS });
  const budgets = await db.budgets.findMany({ select: { category: true, amountCents: true } });
  const budget = budgets.length > 0 ? budgetSummary(transactions, budgets, asOf) : null;
  // The latest month that has any spending.
  const latest =
    [...insights.months].reverse().find((m) => m.spendingCents > 0)?.month ??
    insights.months.at(-1)!.month;
  const categories = insights.categoriesByMonth[latest];

  return (
    <>
      <AppHeader email={user.email} />
      <ViewTracker event="insights_viewed" />
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Where your money goes</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          The last {INSIGHT_MONTHS} months from your accounts. Moving money between your own
          accounts and paying off cards isn&apos;t counted as spending.{" "}
          <Link href="/transactions" className="font-medium text-emerald-700 hover:underline">
            Fix a category
          </Link>{" "}
          ·{" "}
          <Link href="/budgets" className="font-medium text-emerald-700 hover:underline">
            Budgets
          </Link>
        </p>
      </div>

      {budget && <BudgetList progress={budget.progress} daysLeft={budget.daysLeft} />}

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">Income and spending by month</h2>
        <MonthBars months={insights.months} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">{monthName(latest)} by category</h2>
        {categories.length === 0 ? (
          <p className="text-zinc-600 dark:text-zinc-400">No spending that month.</p>
        ) : (
          <HorizontalBars rows={categories.map((c) => ({ label: c.category, cents: c.cents }))} />
        )}
      </section>

      {insights.changes.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold">Biggest changes from last month</h2>
          <ul className="flex flex-col gap-1 text-sm">
            {insights.changes.map((c) => (
              <li key={c.category} className="flex justify-between gap-2">
                <span>{c.category}</span>
                <span
                  className={
                    c.changeCents > 0 ? "text-red-700 dark:text-red-400" : "text-emerald-700"
                  }
                >
                  {c.changeCents > 0 ? "up" : "down"} {formatCents(Math.abs(c.changeCents))}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">Where you spend the most</h2>
        <HorizontalBars
          rows={insights.topMerchants.map((m) => ({ label: m.merchant, cents: m.cents }))}
        />
      </section>
    </>
  );
}

export default function InsightsPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<p className="text-zinc-500">Adding things up…</p>}>
        <Insights />
      </Suspense>
    </main>
  );
}
