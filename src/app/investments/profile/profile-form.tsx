"use client";

import { useActionState } from "react";
import {
  DROP_QUESTION_PERCENT,
  DROP_REACTIONS,
  GOALS,
  HORIZONS,
  MAX_AGE,
  MIN_AGE,
} from "@/config/investing";
import { saveProfile, type ProfileFormInput, type ProfileState } from "./actions";

const INPUT =
  "h-11 w-28 rounded-lg border border-zinc-300 bg-transparent px-3 text-base dark:border-zinc-700";
const FIELDSET = "flex flex-col gap-2 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800";
const OPTION = "flex items-center gap-2 text-sm";

export function ProfileForm({ values }: { values: ProfileFormInput }) {
  const [state, action, pending] = useActionState<ProfileState, FormData>(saveProfile, null);
  const shown = state?.input ?? values;
  return (
    <form action={action} className="flex flex-col gap-4">
      <label htmlFor="profile-age" className="flex flex-col gap-1 text-sm font-medium">
        How old are you?
        <input
          id="profile-age"
          name="age"
          type="number"
          inputMode="numeric"
          min={MIN_AGE}
          max={MAX_AGE}
          defaultValue={shown.age}
          className={INPUT}
        />
      </label>
      <fieldset className={FIELDSET}>
        <legend className="px-1 text-sm font-medium">When will you need most of this money?</legend>
        {Object.entries(HORIZONS).map(([value, h]) => (
          <label key={value} className={OPTION}>
            <input
              type="radio"
              name="horizon"
              value={value}
              defaultChecked={shown.horizon === value}
            />
            {h.label}
          </label>
        ))}
      </fieldset>
      <fieldset className={FIELDSET}>
        <legend className="px-1 text-sm font-medium">
          If your investments fell {DROP_QUESTION_PERCENT}% in a month, what would you do?
        </legend>
        {Object.entries(DROP_REACTIONS).map(([value, d]) => (
          <label key={value} className={OPTION}>
            <input
              type="radio"
              name="dropReaction"
              value={value}
              defaultChecked={shown.dropReaction === value}
            />
            {d.label}
          </label>
        ))}
      </fieldset>
      <fieldset className={FIELDSET}>
        <legend className="px-1 text-sm font-medium">What&apos;s the money for? Pick any.</legend>
        {Object.entries(GOALS).map(([value, label]) => (
          <label key={value} className={OPTION}>
            <input
              type="checkbox"
              name="goals"
              value={value}
              defaultChecked={shown.goals.includes(value)}
            />
            {label}
          </label>
        ))}
      </fieldset>
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
