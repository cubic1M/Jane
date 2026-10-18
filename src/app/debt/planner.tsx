"use client";

import { useMemo, useState } from "react";
import { formatCents, parseMoneyToCents } from "@/lib/money";
import { PLANNER_COPY } from "@/planning/debt-copy";
import {
  parseApr,
  payoffPlan,
  type DebtCard,
  type PayoffPlan,
  type Strategy,
} from "@/planning/debt";

type Row = {
  id: string;
  name: string;
  balance: string;
  apr: string;
  minimum: string;
  // The rate and minimum were filled in from the bank (Plaid Liabilities).
  fromBank: boolean;
};

const INPUT =
  "h-11 w-full rounded-lg border border-zinc-300 bg-transparent px-3 text-base dark:border-zinc-700";
const STRATEGIES: Strategy[] = ["avalanche", "snowball"];

const dollars = (cents: number) => (cents / 100).toFixed(2);

export function DebtPlanner({
  cards,
  startYear,
  startMonth,
  maxCards,
}: {
  cards: {
    id: string;
    name: string;
    balanceCents: number;
    aprBps: number | null;
    minimumCents: number | null;
  }[];
  startYear: number;
  // 0-based, like Date.getUTCMonth.
  startMonth: number;
  maxCards: number;
}) {
  const [rows, setRows] = useState<Row[]>(() =>
    cards.length > 0
      ? cards.map((c) => ({
          id: c.id,
          name: c.name,
          balance: dollars(c.balanceCents),
          apr: c.aprBps === null ? "" : (c.aprBps / 100).toFixed(2),
          minimum: c.minimumCents === null ? "" : dollars(c.minimumCents),
          fromBank: c.aprBps !== null && c.minimumCents !== null,
        }))
      : [{ id: "manual-1", name: "Card 1", balance: "", apr: "", minimum: "", fromBank: false }],
  );
  const [budget, setBudget] = useState("");

  const monthLabel = (month: number) =>
    new Date(Date.UTC(startYear, startMonth + month, 1)).toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    });

  // Null until every field reads as a number.
  const parsed = useMemo(() => {
    const debts: DebtCard[] = [];
    for (const row of rows) {
      const balanceCents = parseMoneyToCents(row.balance);
      const aprBps = parseApr(row.apr);
      const minimumCents = parseMoneyToCents(row.minimum);
      if (balanceCents === null || aprBps === null || minimumCents === null) return null;
      if (balanceCents < 0 || minimumCents < 0) return null;
      debts.push({ id: row.id, name: row.name, balanceCents, aprBps, minimumCents });
    }
    const budgetCents = parseMoneyToCents(budget);
    return budgetCents === null ? null : { debts, budgetCents };
  }, [rows, budget]);

  const plans = useMemo(
    () => (parsed ? STRATEGIES.map((s) => payoffPlan(parsed.debts, parsed.budgetCents, s)) : null),
    [parsed],
  );

  const update = (id: string, field: keyof Row, value: string) =>
    setRows((current) => current.map((r) => (r.id === id ? { ...r, [field]: value } : r)));

  return (
    <div className="flex flex-col gap-6">
      {cards.length === 0 && (
        <p className="text-zinc-600 dark:text-zinc-400">{PLANNER_COPY.noCards}</p>
      )}
      <ul className="flex flex-col gap-4">
        {rows.map((row) => (
          <li
            key={row.id}
            className="grid gap-3 rounded-xl border border-zinc-200 p-4 sm:grid-cols-4 dark:border-zinc-800"
          >
            <label className="flex flex-col gap-1 text-sm font-medium">
              Card or loan
              <input
                className={INPUT}
                value={row.name}
                onChange={(e) => update(row.id, "name", e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              Balance ($)
              <input
                className={INPUT}
                inputMode="decimal"
                value={row.balance}
                onChange={(e) => update(row.id, "balance", e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              Rate (APR %)
              <input
                className={INPUT}
                inputMode="decimal"
                placeholder="e.g. 24.99"
                value={row.apr}
                onChange={(e) => update(row.id, "apr", e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              Minimum payment ($)
              <input
                className={INPUT}
                inputMode="decimal"
                value={row.minimum}
                onChange={(e) => update(row.id, "minimum", e.target.value)}
              />
            </label>
            {row.fromBank && (
              <p className="text-sm text-zinc-600 sm:col-span-4 dark:text-zinc-400">
                {PLANNER_COPY.fromBank}
              </p>
            )}
          </li>
        ))}
      </ul>
      {rows.length < maxCards && (
        <button
          type="button"
          onClick={() =>
            setRows((current) => [
              ...current,
              {
                id: `manual-${current.length + 1}`,
                name: `Card ${current.length + 1}`,
                balance: "",
                apr: "",
                minimum: "",
                fromBank: false,
              },
            ])
          }
          className="self-start text-sm font-medium text-emerald-700 hover:underline"
        >
          Add a card or loan
        </button>
      )}

      <label className="flex flex-col gap-1 font-medium sm:max-w-xs">
        Paid toward these debts each month ($)
        <input
          className={INPUT}
          inputMode="decimal"
          value={budget}
          onChange={(e) => setBudget(e.target.value)}
        />
      </label>

      {plans === null ? (
        <p className="text-sm text-zinc-500">Fill in every box to see the numbers.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {plans.map((plan) => (
            <PlanSummary key={plan.strategy} plan={plan} rows={rows} monthLabel={monthLabel} />
          ))}
        </div>
      )}
    </div>
  );
}

function PlanSummary({
  plan,
  rows,
  monthLabel,
}: {
  plan: PayoffPlan;
  rows: Row[];
  monthLabel: (month: number) => string;
}) {
  const copy = PLANNER_COPY.strategies[plan.strategy];
  return (
    <section
      aria-label={copy.name}
      className="flex flex-col gap-2 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
    >
      <h2 className="text-lg font-semibold">{copy.name}</h2>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        {copy.how} {copy.also}
      </p>
      {plan.ok ? (
        <>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <dt>Total interest</dt>
            <dd className="text-right font-semibold">{formatCents(plan.totalInterestCents)}</dd>
            <dt>Total paid</dt>
            <dd className="text-right">{formatCents(plan.totalPaidCents)}</dd>
            <dt>Debt-free</dt>
            <dd className="text-right">
              {monthLabel(plan.months)} ({plan.months} {plan.months === 1 ? "month" : "months"})
            </dd>
          </dl>
          <ul className="flex flex-col gap-1 border-t border-zinc-200 pt-2 text-sm dark:border-zinc-800">
            {rows
              .filter((r) => plan.paidOffMonth[r.id] !== undefined)
              .sort((a, b) => plan.paidOffMonth[a.id] - plan.paidOffMonth[b.id])
              .map((r) => (
                <li key={r.id} className="flex justify-between gap-2">
                  <span className="min-w-0 break-words">{r.name}</span>
                  <span className="shrink-0">paid off {monthLabel(plan.paidOffMonth[r.id])}</span>
                </li>
              ))}
          </ul>
        </>
      ) : (
        <p role="alert" className="text-sm text-amber-800 dark:text-amber-300">
          {plan.reason === "budget_below_minimums"
            ? PLANNER_COPY.budgetBelowMinimums
            : PLANNER_COPY.neverPaysOff}
        </p>
      )}
    </section>
  );
}
