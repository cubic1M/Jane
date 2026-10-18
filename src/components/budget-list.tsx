import Link from "next/link";
import type { BudgetProgress } from "@/insights/budgets";
import { formatCents } from "@/lib/money";

// A compact view of this month's budgets, for Home and Insights.
export function BudgetList({
  progress,
  daysLeft,
}: {
  progress: BudgetProgress[];
  daysLeft: number;
}) {
  if (progress.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-xl font-semibold">Budgets this month</h2>
        <Link href="/budgets" className="text-sm font-medium text-emerald-700 hover:underline">
          All budgets
        </Link>
      </div>
      <ul className="divide-y divide-zinc-200 rounded-xl border border-zinc-200 text-sm dark:divide-zinc-800 dark:border-zinc-800">
        {progress.map((p) => (
          <li key={p.category} className="flex flex-wrap justify-between gap-2 px-4 py-2">
            <span>{p.category}</span>
            <span className={p.over ? "font-semibold text-red-700" : ""}>
              {formatCents(p.spentCents)} of {formatCents(p.budgetCents)}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-zinc-500">
        {daysLeft} day{daysLeft === 1 ? "" : "s"} left this month.
      </p>
    </section>
  );
}
