import { connection } from "next/server";
import { AppHeader } from "@/components/app-header";
import { BUDGET_SUGGESTION_MONTHS } from "@/config/budgets";
import { budgetSummary, completeMonthsWords, daysLeftWords } from "@/insights/budgets";
import type { IrregularItem } from "@/insights/irregular";
import { loadInsightTransactions } from "@/insights/load";
import { BUDGET_CATEGORIES } from "@/lib/budgets";
import { scopedDb } from "@/lib/db-scoped";
import { irregularCosts } from "@/lib/irregular";
import { centsToInput, formatCents } from "@/lib/money";
import { currentProposals } from "@/lib/proposals";
import { describe } from "@/lib/jane-agent/sources/setup";
import type { BudgetProposal } from "@/planning/proposals";
import { requireUser } from "@/lib/session";
import { todayOf } from "@/lib/today";
import { deleteBudget } from "./actions";
import { BudgetForm } from "./budget-form";
import { SubmitButton } from "@/components/submit-button";
import { ProgressBar } from "@/components/progress-bar";
import { dayLabel } from "@/lib/day-label";
import { PageShell } from "@/components/page-shell";
import { CARD, CARD_TIGHT } from "@/components/card";

const HOW_OFTEN: Record<IrregularItem["frequency"], string> = {
  QUARTERLY: "Every 3 months",
  SEMIANNUALLY: "Twice a year",
  ANNUALLY: "Once a year",
};

async function Budgets({ searchParams }: { searchParams: PageProps<"/budgets">["searchParams"] }) {
  await connection();
  const user = await requireUser();
  // A set-up card's "Open the form" (src/lib/jane-agent/sources/setup.ts setupHref): its budget,
  // drafted, with the card's words above the form.
  const { draft } = await searchParams;
  const proposal =
    typeof draft === "string"
      ? (await currentProposals(user.id)).find(
          (p): p is BudgetProposal => p.kind === "budget" && p.category === draft,
        )
      : undefined;
  const db = await scopedDb();
  const now = new Date();
  const asOf = await todayOf(user.id, { now });
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
          Insights. {daysLeftWords(summary.daysLeft)}
        </p>
      </div>

      {summary.progress.length > 0 && (
        <ul className="flex flex-col gap-3">
          {summary.progress.map((p) => {
            const share = Math.min(100, Math.round((p.spentCents / p.budgetCents) * 100));
            return (
              <li key={p.category} className={CARD}>
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
              <li key={item.key} className={CARD_TIGHT}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="font-semibold">{item.name}</h3>
                  <span className="text-sm">{formatCents(item.monthlyCents)} a month</span>
                </div>
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  {item.kind === "seasonal"
                    ? `Each year, above your usual month: ${formatCents(item.yearlyCents)}.`
                    : `${HOW_OFTEN[item.frequency]}, ${formatCents(item.yearlyCents)} a year.`}{" "}
                  Next about {dayLabel(item.nextDate, { year: true })}, around{" "}
                  {formatCents(item.nextAmountCents)}.
                </p>
                <p className="text-sm">
                  Putting a little aside each month since the last one would have built up{" "}
                  {formatCents(item.byNowCents)} of {formatCents(item.nextAmountCents)} by now.
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
          The averages in brackets are your own spending over the last{" "}
          {completeMonthsWords(summary.months)}, as a starting point; pick whatever suits you.
        </p>
        {proposal && (
          <p data-card-working="" className="text-sm text-zinc-600 dark:text-zinc-400">
            {describe(proposal)}
          </p>
        )}
        <BudgetForm
          categories={BUDGET_CATEGORIES}
          suggestions={summary.suggestions}
          draft={
            proposal
              ? { category: proposal.category, amount: centsToInput(proposal.amountCents) }
              : null
          }
        />
      </section>
    </>
  );
}

export default function BudgetsPage({ searchParams }: PageProps<"/budgets">) {
  return (
    <PageShell>
      <Budgets searchParams={searchParams} />
    </PageShell>
  );
}
