"use client";

import { useActionState } from "react";
import { saveSideIncomeAction, type TaxProfileState } from "./actions";

// A rental's property and hobby or business (spec step 173).

export type SideIncomeValues = { price: string; placedOn: string; kind: string };

const INPUT =
  "h-11 rounded-lg border border-zinc-300 bg-white px-3 text-base dark:border-zinc-700 dark:bg-zinc-950";

export function SideIncomeForm({ values }: { values: SideIncomeValues }) {
  const [state, action, pending] = useActionState<TaxProfileState, FormData>(
    saveSideIncomeAction,
    null,
  );
  return (
    <form
      action={action}
      id="side-income"
      className="flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
    >
      <h2 className="font-semibold">Side income and rentals</h2>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        For a rental: the price you paid and when it was ready to rent, so Jane can work out
        depreciation (the building over 27.5 years). Tag what you spend on it as rental expenses.
        Leave them empty to clear.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-sm">Price paid for the rental ($)</span>
          <input
            name="rentalPrice"
            inputMode="decimal"
            defaultValue={values.price}
            className={INPUT}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm">Ready to rent on</span>
          <input
            name="rentalPlacedOn"
            type="date"
            defaultValue={values.placedOn}
            className={INPUT}
          />
        </label>
      </div>
      <label className="flex flex-col gap-1">
        <span className="text-sm">Your gig or freelance income is a</span>
        <select name="sideIncomeKind" defaultValue={values.kind} className={INPUT}>
          <option value="">Not said</option>
          <option value="business">Business</option>
          <option value="hobby">Hobby</option>
        </select>
      </label>
      <p
        role="status"
        className={
          state
            ? `rounded-lg p-3 text-sm ${
                state.ok
                  ? "bg-emerald-50 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100"
                  : "bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200"
              }`
            : "sr-only"
        }
      >
        {state?.message ?? ""}
      </p>
      <button
        type="submit"
        disabled={pending}
        className="inline-flex h-11 items-center justify-center self-start rounded-full bg-emerald-700 px-5 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-60"
      >
        Save side income
      </button>
    </form>
  );
}
