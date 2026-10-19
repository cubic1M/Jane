"use client";

import { useActionState } from "react";
import { saveAutoInvest, type AutoInvestState } from "./actions";

const INPUT =
  "h-11 min-w-0 rounded-lg border border-zinc-300 bg-transparent px-3 text-base dark:border-zinc-700";

export function AutoInvestForm({
  accounts,
  values,
}: {
  accounts: { id: string; name: string }[];
  values: { mode: string; amount: string; accountId: string };
}) {
  const [state, action, pending] = useActionState<AutoInvestState, FormData>(saveAutoInvest, null);
  return (
    <form action={action} className="flex flex-col gap-3">
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">How much, each payday</legend>
        <label className="flex flex-wrap items-center gap-2 text-sm">
          <input
            type="radio"
            name="mode"
            value="fixed"
            defaultChecked={values.mode !== "leftover"}
          />
          This amount ($)
          <input
            name="amount"
            inputMode="decimal"
            aria-label="Amount each payday in dollars"
            defaultValue={values.amount}
            className={`${INPUT} w-32`}
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="mode"
            value="leftover"
            defaultChecked={values.mode === "leftover"}
          />
          The rest after bills and goals
        </label>
      </fieldset>
      <label htmlFor="auto-account" className="flex flex-col gap-1 text-sm font-medium">
        Into
        <select
          id="auto-account"
          name="accountId"
          defaultValue={values.accountId}
          className={INPUT}
        >
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>
      {state && (
        <p role="alert" className="text-sm text-red-700">
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
