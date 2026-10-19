"use client";

import { useActionState } from "react";
import { FILING_STATUSES, INCOME_KINDS, MAX_DEPENDANTS, type IncomeKind } from "@/config/tax";
import { saveTaxProfile, type TaxProfileState } from "./actions";

// The tax profile form (spec step 118). Prefilled with the person's answers, and with what
// Jane found (marked so) where they haven't answered yet.

export type ProfileFormValues = {
  incomeKinds: { kind: IncomeKind; checked: boolean; seen: string | null }[];
  filingStatus: string;
  childrenUnder17: string;
  otherDependants: string;
  state: string;
  stateNote: string | null;
  states: { code: string; name: string }[];
};

const INPUT =
  "h-11 rounded-lg border border-zinc-300 bg-white px-3 text-base dark:border-zinc-700 dark:bg-zinc-950";
const FIELDSET = "flex flex-col gap-2 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800";

export function TaxProfileForm({ values }: { values: ProfileFormValues }) {
  const [state, action, pending] = useActionState<TaxProfileState, FormData>(saveTaxProfile, null);
  return (
    <form action={action} className="flex flex-col gap-4">
      <fieldset className={FIELDSET} id="income">
        <legend className="px-1 font-semibold">Your kinds of income</legend>
        {values.incomeKinds.map(({ kind, checked, seen }) => (
          <label key={kind} className="flex min-h-11 items-start gap-3">
            <input
              type="checkbox"
              name="incomeKinds"
              value={kind}
              defaultChecked={checked}
              className="mt-1 size-5"
            />
            <span>
              {INCOME_KINDS[kind].label}{" "}
              <span className="text-sm text-zinc-600 dark:text-zinc-400">
                ({INCOME_KINDS[kind].form})
              </span>
              {seen && (
                <span className="block text-sm text-zinc-600 dark:text-zinc-400">
                  Found by Jane: {seen}
                </span>
              )}
            </span>
          </label>
        ))}
        <label className="flex min-h-11 items-center gap-3">
          <input type="checkbox" name="noIncome" value="1" className="size-5" />
          <span>None of these</span>
        </label>
      </fieldset>

      <fieldset className={FIELDSET}>
        <legend className="px-1 font-semibold">How you file</legend>
        {Object.entries(FILING_STATUSES).map(([value, label]) => (
          <label key={value} className="flex min-h-11 items-center gap-3">
            <input
              type="radio"
              name="filingStatus"
              value={value}
              defaultChecked={values.filingStatus === value}
              className="size-5"
            />
            <span>{label}</span>
          </label>
        ))}
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          A surviving spouse who can use the joint figures picks married filing jointly here.
        </p>
      </fieldset>

      <fieldset className={FIELDSET}>
        <legend className="px-1 font-semibold">Dependants</legend>
        <label className="flex flex-col gap-1">
          <span>Children under 17 you claim</span>
          <input
            name="childrenUnder17"
            type="number"
            min={0}
            max={MAX_DEPENDANTS}
            inputMode="numeric"
            defaultValue={values.childrenUnder17}
            className={INPUT}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span>Other dependants (older children, parents, relatives)</span>
          <input
            name="otherDependants"
            type="number"
            min={0}
            max={MAX_DEPENDANTS}
            inputMode="numeric"
            defaultValue={values.otherDependants}
            className={INPUT}
          />
        </label>
      </fieldset>

      <fieldset className={FIELDSET}>
        <legend className="px-1 font-semibold">The state you file in</legend>
        <select
          name="state"
          defaultValue={values.state}
          aria-label="State"
          className={`${INPUT} max-w-full`}
        >
          <option value="">Not set</option>
          {values.states.map((s) => (
            <option key={s.code} value={s.code}>
              {s.name}
            </option>
          ))}
        </select>
        {values.stateNote && (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">{values.stateNote}</p>
        )}
      </fieldset>

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
        Save my answers
      </button>
    </form>
  );
}
