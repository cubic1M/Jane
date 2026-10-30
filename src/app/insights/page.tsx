import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppHeader, PageLoading } from "@/components/app-header";
import { ViewTracker } from "@/components/view-tracker";
import { INSIGHT_MONTHS } from "@/config/insights";
import { BudgetList } from "@/components/budget-list";
import { cashIncomeStatus } from "@/categorize/cash-income";
import { budgetSummary } from "@/insights/budgets";
import { loadInsightTransactions } from "@/insights/load";
import { spendingInsights, spendingLines } from "@/insights/spending";
import { accountLabels } from "@/lib/account-labels";
import { scopedDb } from "@/lib/db-scoped";
import { requireUser } from "@/lib/session";
import { CashIncomeNote } from "./cash-income";
import { SpendingExplorer } from "./explorer";

async function Insights() {
  const user = await requireUser();
  const db = await scopedDb();
  const asOf = new Date().toISOString().slice(0, 10);
  const transactions = await loadInsightTransactions(db, asOf, INSIGHT_MONTHS);
  if (transactions.length === 0) redirect("/home");

  const insights = spendingInsights(transactions, { asOf, monthCount: INSIGHT_MONTHS });
  const [budgets, accounts, cash] = await Promise.all([
    db.budgets.findMany({ select: { category: true, amountCents: true } }),
    db.accounts.findMany({ select: { id: true, name: true, mask: true, createdAt: true } }),
    cashIncomeStatus(db),
  ]);
  const budget = budgets.length > 0 ? budgetSummary(transactions, budgets, asOf) : null;
  // The latest month that has any spending.
  const latest =
    [...insights.months].reverse().find((m) => m.spendingCents > 0)?.month ??
    insights.months.at(-1)!.month;
  const lines = spendingLines(transactions, {
    asOf,
    monthCount: INSIGHT_MONTHS,
    accountNames: accountLabels(accounts),
  });

  return (
    <>
      <AppHeader user={user} />
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
          </Link>{" "}
          ·{" "}
          <Link href="/goals" className="font-medium text-emerald-700 hover:underline">
            Goals
          </Link>
        </p>
      </div>

      {budget && <BudgetList progress={budget.progress} daysLeft={budget.daysLeft} />}

      <SpendingExplorer
        months={insights.months}
        categoriesByMonth={insights.categoriesByMonth}
        initialMonth={latest}
        changes={insights.changes}
        topMerchants={insights.topMerchants}
        lines={lines}
        incomeNote={cash && <CashIncomeNote status={cash} />}
      />
    </>
  );
}

export default function InsightsPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<PageLoading label="Adding things up" />}>
        <Insights />
      </Suspense>
    </main>
  );
}
