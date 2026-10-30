"use client";

import { useActionState } from "react";
import { COLLEGE_TYPES } from "@/config/college";
import { saveCollegePlan, type CollegeState } from "./actions";

const INPUT =
  "h-11 min-w-0 rounded-lg border border-zinc-300 bg-transparent px-3 text-base dark:border-zinc-700";

export function CollegeForm() {
  const [state, action, pending] = useActionState<CollegeState, FormData>(saveCollegePlan, null);
  return (
    <form action={action} className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <label htmlFor="college-name" className="flex flex-col gap-1 text-sm font-medium">
        Child&apos;s first name
        <input id="college-name" name="childName" className={INPUT} placeholder="Sam" />
      </label>
      <label htmlFor="college-age" className="flex flex-col gap-1 text-sm font-medium">
        Age now
        <input
          id="college-age"
          name="childAge"
          type="number"
          min={0}
          max={17}
          inputMode="numeric"
          className={INPUT}
        />
      </label>
      <label htmlFor="college-type" className="flex flex-col gap-1 text-sm font-medium">
        Kind of college
        <select id="college-type" name="type" className={INPUT} defaultValue="public">
          {Object.entries(COLLEGE_TYPES).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {state && (
        <p role="alert" className="text-sm text-red-700 sm:col-span-3">
          {state.message}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="h-11 self-start rounded-lg bg-emerald-700 px-5 font-medium text-white hover:bg-emerald-800 disabled:opacity-60 sm:col-span-3"
      >
        Start saving for college
      </button>
    </form>
  );
}
