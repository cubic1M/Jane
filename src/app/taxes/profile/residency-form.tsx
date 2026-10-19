"use client";

import { useActionState } from "react";
import { saveResidencyAction, type TaxProfileState } from "./actions";

// Where the person lived and worked (spec step 165): a move this year, an employer in
// another state, and the city income tax they live under.

export type ResidencyValues = {
  year: number;
  movedOn: string;
  movedFrom: string;
  movedTo: string;
  // Jane spotted the move and is using it until the person saves.
  spottedNote: string | null;
  oneState: boolean;
  workState: string;
  locality: string;
  localities: { key: string; label: string }[];
  states: { code: string; name: string }[];
};

const INPUT =
  "h-11 rounded-lg border border-zinc-300 bg-white px-3 text-base dark:border-zinc-700 dark:bg-zinc-950";

function StateSelect({
  name,
  label,
  value,
  states,
  empty,
}: {
  name: string;
  label: string;
  value: string;
  states: ResidencyValues["states"];
  empty: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm">{label}</span>
      <select name={name} defaultValue={value} className={INPUT}>
        <option value="">{empty}</option>
        {states.map((s) => (
          <option key={s.code} value={s.code}>
            {s.name}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ResidencyForm({ values }: { values: ResidencyValues }) {
  const [state, action, pending] = useActionState<TaxProfileState, FormData>(
    saveResidencyAction,
    null,
  );
  return (
    <form
      action={action}
      id="states"
      className="flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
    >
      <h2 className="font-semibold">Where you lived and worked</h2>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        A move in {values.year} splits your state taxes between the two states: wages by where you
        lived on each payday, other income by the days you lived in each. Working from home for an
        employer in another state can mean both states tax your wages.
      </p>
      {values.spottedNote && (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
          {values.spottedNote}
        </p>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1">
          <span className="text-sm">Moved on</span>
          <input name="movedOn" type="date" defaultValue={values.movedOn} className={INPUT} />
        </label>
        <StateSelect
          name="movedFrom"
          label="From"
          value={values.movedFrom}
          states={values.states}
          empty="Pick a state"
        />
        <StateSelect
          name="movedTo"
          label="To"
          value={values.movedTo}
          states={values.states}
          empty="Pick a state"
        />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="oneState" defaultChecked={values.oneState} />I lived in one
        state all of {values.year}
      </label>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <StateSelect
          name="workState"
          label="My employer is in"
          value={values.workState}
          states={values.states}
          empty="The state I live in"
        />
        <label className="flex flex-col gap-1">
          <span className="text-sm">City or county income tax</span>
          <select name="locality" defaultValue={values.locality} className={INPUT}>
            <option value="">Not asked yet</option>
            <option value="none">None where I live</option>
            {values.localities.map((l) => (
              <option key={l.key} value={l.key}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
      </div>
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
        Save where I lived
      </button>
    </form>
  );
}
