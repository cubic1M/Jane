"use client";

import { useActionState } from "react";
import { saveBudget, type BudgetState } from "./actions";

export function BudgetForm({
  categories,
  suggestions,
}: {
  categories: readonly string[];
  // Average monthly spending per category (cents), shown as a starting point.
  suggestions: Record<string, number>;
}) {
  const [state, action, pending] = useActionState<BudgetState, FormData>(saveBudget, null);
  return (
    <form action={action} className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <label className="flex flex-col gap-1 text-sm font-medium">
        Category
        <select
          name="category"
          className="h-11 rounded-lg border border-zinc-300 bg-transparent px-3 text-base dark:border-zinc-700"
        >
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
              {suggestions[c] ? ` (you average about $${Math.round(suggestions[c] / 100)})` : ""}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Monthly budget ($)
        <input
          name="amount"
          inputMode="decimal"
          className="h-11 rounded-lg border border-zinc-300 bg-transparent px-3 text-base dark:border-zinc-700"
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="inline-flex h-11 items-center justify-center rounded-full bg-emerald-700 px-6 font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
      >
        {pending ? "Saving…" : "Set budget"}
      </button>
      {state && (
        <p
          role={state.ok ? "status" : "alert"}
          className={state.ok ? "text-emerald-700" : "text-red-700"}
        >
          {state.message}
        </p>
      )}
    </form>
  );
}
