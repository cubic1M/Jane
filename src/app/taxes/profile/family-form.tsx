"use client";

import { useActionState } from "react";
import { saveFamilyAction, type TaxProfileState } from "./actions";

// Family details (spec step 169): what the family tax choices need that Jane can't see.
// Each child's age at the end of the year, Social Security number and months at home; a
// spouse's wages; who pays for the home; a student's years of college.

export type FamilyValues = {
  year: number;
  children: { age: string; ssn: boolean; months: string }[];
  spouseWages: string;
  paysOverHalfHome: boolean;
  studentYears: string;
  studentHalfTime: boolean;
};

const INPUT =
  "h-11 rounded-lg border border-zinc-300 bg-white px-3 text-base dark:border-zinc-700 dark:bg-zinc-950";

export function FamilyForm({ values }: { values: FamilyValues }) {
  const [state, action, pending] = useActionState<TaxProfileState, FormData>(
    saveFamilyAction,
    null,
  );
  return (
    <form
      action={action}
      id="family"
      className="flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
    >
      <h2 className="font-semibold">Family details</h2>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        For comparing your family&apos;s tax choices for {values.year}. Leave a child&apos;s age
        empty to leave that row out.
      </p>
      {values.children.map((c, i) => (
        <fieldset key={i} className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <legend className="text-sm font-medium">Child {i + 1}</legend>
          <label className="flex flex-col gap-1">
            <span className="text-sm">Age on December 31</span>
            <input
              name={`childAge${i}`}
              inputMode="numeric"
              defaultValue={c.age}
              className={INPUT}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm">Months living with you</span>
            <input
              name={`childMonths${i}`}
              inputMode="numeric"
              defaultValue={c.months}
              className={INPUT}
            />
          </label>
          <label className="flex items-center gap-2 text-sm sm:mt-6">
            <input type="checkbox" name={`childSsn${i}`} defaultChecked={c.ssn} />
            Has a Social Security number
          </label>
        </fieldset>
      ))}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-sm">Your spouse&apos;s wages for the year ($)</span>
          <input
            name="spouseWages"
            inputMode="decimal"
            defaultValue={values.spouseWages}
            className={INPUT}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm">A student&apos;s years of college before this one</span>
          <input
            name="studentYears"
            inputMode="numeric"
            defaultValue={values.studentYears}
            className={INPUT}
          />
        </label>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="studentHalfTime" defaultChecked={values.studentHalfTime} />
        The student is at least half-time
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="paysOverHalfHome" defaultChecked={values.paysOverHalfHome} />I
        pay more than half the cost of keeping up my home
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
        Save family details
      </button>
    </form>
  );
}
