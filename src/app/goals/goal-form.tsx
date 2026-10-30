"use client";

import { useActionState } from "react";
import { saveGoal, type GoalState } from "./actions";

const INPUT =
  "h-11 rounded-lg border border-zinc-300 bg-transparent px-3 text-base dark:border-zinc-700";

export type GoalFormValues = {
  goalId: string;
  name: string;
  target: string;
  targetDate: string;
  accountId: string;
  saved: string;
};

export function GoalForm({
  values,
  accounts,
}: {
  values: GoalFormValues;
  accounts: { id: string; name: string }[];
}) {
  const [state, action, pending] = useActionState<GoalState, FormData>(saveGoal, null);
  const id = (name: string) => `${values.goalId || "new"}-${name}`;
  return (
    <form action={action} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <input type="hidden" name="goalId" value={values.goalId} />
      <label htmlFor={id("name")} className="flex flex-col gap-1 text-sm font-medium">
        What it&apos;s for
        <input
          id={id("name")}
          name="name"
          defaultValue={values.name}
          placeholder="Emergency fund"
          className={INPUT}
        />
      </label>
      <label htmlFor={id("target")} className="flex flex-col gap-1 text-sm font-medium">
        Amount ($)
        <input
          id={id("target")}
          name="target"
          inputMode="decimal"
          defaultValue={values.target}
          className={INPUT}
        />
      </label>
      <label htmlFor={id("targetDate")} className="flex flex-col gap-1 text-sm font-medium">
        By
        <input
          id={id("targetDate")}
          name="targetDate"
          type="date"
          defaultValue={values.targetDate}
          className={INPUT}
        />
      </label>
      <label htmlFor={id("accountId")} className="flex flex-col gap-1 text-sm font-medium">
        Track with
        <select
          id={id("accountId")}
          name="accountId"
          defaultValue={values.accountId}
          className={INPUT}
        >
          <option value="">An amount I enter</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>
      <label htmlFor={id("saved")} className="flex flex-col gap-1 text-sm font-medium">
        Saved so far ($), if tracking by hand
        <input
          id={id("saved")}
          name="saved"
          inputMode="decimal"
          defaultValue={values.saved}
          className={INPUT}
        />
      </label>
      {state && (
        <p
          role={state.ok ? "status" : "alert"}
          className={`sm:col-span-2 ${state.ok ? "text-emerald-700" : "text-red-700"}`}
        >
          {state.message}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="inline-flex h-11 items-center justify-center self-end rounded-full bg-emerald-700 px-6 font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
      >
        {pending ? "Saving…" : values.goalId ? "Save goal" : "Add goal"}
      </button>
    </form>
  );
}
