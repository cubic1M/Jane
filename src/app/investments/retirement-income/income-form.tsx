"use client";

import { useActionState } from "react";
import { saveIncome, type IncomeState } from "./actions";

const INPUT =
  "h-11 min-w-0 rounded-lg border border-zinc-300 bg-transparent px-3 text-base dark:border-zinc-700";

type Initial = { ssMonthly: string; retireAge: string; ssStartAge: string; spendMonthly: string };

export function IncomeForm({ initial }: { initial: Initial }) {
  const [state, action, pending] = useActionState<IncomeState, FormData>(saveIncome, null);
  const field = (id: keyof Initial, label: string, inputMode: "decimal" | "numeric") => (
    <label htmlFor={`income-${id}`} className="flex flex-col gap-1 text-sm font-medium">
      {label}
      <input
        id={`income-${id}`}
        name={id}
        inputMode={inputMode}
        defaultValue={initial[id]}
        className={INPUT}
      />
    </label>
  );
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      {field(
        "ssMonthly",
        "Social Security a month at full retirement age (from your ssa.gov statement)",
        "decimal",
      )}
      {field("retireAge", "Age you plan to retire", "numeric")}
      {field("ssStartAge", "Age to start Social Security (62 to 70)", "numeric")}
      {field("spendMonthly", "What you'd spend a month in retirement (today's dollars)", "decimal")}
      {state && (
        <p role="alert" className="text-sm text-red-700 sm:col-span-2">
          {state.message}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="h-11 self-start rounded-lg bg-emerald-700 px-5 font-medium text-white hover:bg-emerald-800 disabled:opacity-60"
      >
        Save
      </button>
    </form>
  );
}
