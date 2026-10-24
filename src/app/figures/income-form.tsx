"use client";

import { useActionState } from "react";
import { clearIncome, saveIncome, type IncomeState } from "./actions";
import { SubmitButton } from "@/components/submit-button";

// "That's wrong" on income: say what you earn a month, or go back to the average.
export function IncomeForm({ said }: { said: string | null }) {
  const [state, action, pending] = useActionState<IncomeState, FormData>(saveIncome, null);
  return (
    <div className="flex flex-col gap-2">
      <form action={action} className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-sm font-medium">
          What you earn in a month
          <input
            name="income"
            inputMode="decimal"
            defaultValue={said ?? ""}
            placeholder="4500"
            className="min-h-11 w-40 rounded-lg border border-zinc-300 px-3 dark:border-zinc-700 dark:bg-zinc-900"
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="min-h-11 rounded-full bg-emerald-700 px-4 text-sm font-semibold text-white disabled:opacity-50"
        >
          {pending ? "Saving…" : "Use this"}
        </button>
      </form>
      {said && (
        <form action={clearIncome}>
          <SubmitButton className="min-h-11 text-sm font-medium text-emerald-700 hover:underline">
            Go back to the average of my deposits
          </SubmitButton>
        </form>
      )}
      {state && (
        <p
          role={state.ok ? "status" : "alert"}
          className={`text-sm ${state.ok ? "text-emerald-700" : "text-red-700"}`}
        >
          {state.message}
        </p>
      )}
    </div>
  );
}
