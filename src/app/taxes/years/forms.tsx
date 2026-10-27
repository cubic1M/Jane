"use client";

import { useActionState } from "react";
import { PLANNED_EVENT_KINDS } from "@/config/tax-years";
import { yearsAction, type YearsState } from "./actions";
import { FormStatus } from "@/components/form-status";

const INPUT =
  "h-11 rounded-lg border border-zinc-300 bg-white px-3 text-base dark:border-zinc-700 dark:bg-zinc-950";
const BUTTON =
  "inline-flex h-11 items-center justify-center self-start rounded-full bg-emerald-700 px-5 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-60";

export function RetireForm({ current }: { current: number }) {
  const [state, action, pending] = useActionState<YearsState, FormData>(yearsAction, null);
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="intent" value="retire" />
      <label className="flex flex-col gap-1">
        <span className="text-sm">The year you plan to retire</span>
        <input
          name="retireYear"
          inputMode="numeric"
          defaultValue={current}
          className={`${INPUT} w-32`}
        />
      </label>
      <button type="submit" disabled={pending} className={BUTTON}>
        Save
      </button>
      <FormStatus state={state} />
    </form>
  );
}

export function EventForm() {
  const [state, action, pending] = useActionState<YearsState, FormData>(yearsAction, null);
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="intent" value="add" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1">
          <span className="text-sm">What</span>
          <select name="kind" className={INPUT} defaultValue="bonus">
            {Object.entries(PLANNED_EVENT_KINDS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm">Planned year</span>
          <input name="year" inputMode="numeric" className={INPUT} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm">Amount ($)</span>
          <input name="amount" inputMode="decimal" className={INPUT} />
        </label>
      </div>
      <button type="submit" disabled={pending} className={BUTTON}>
        Add it
      </button>
      <FormStatus state={state} />
    </form>
  );
}

export function RemoveButton({ id, label }: { id: string; label: string }) {
  const [state, action, pending] = useActionState<YearsState, FormData>(yearsAction, null);
  return (
    <form action={action} className="flex items-center gap-3">
      <input type="hidden" name="intent" value="remove" />
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        disabled={pending}
        aria-label={`Remove ${label}`}
        className="text-sm font-medium text-emerald-700 underline"
      >
        Remove
      </button>
      <FormStatus state={state} />
    </form>
  );
}

export function PlanButton({ moveKey, label }: { moveKey: string; label: string }) {
  const [state, action, pending] = useActionState<YearsState, FormData>(yearsAction, null);
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="intent" value="plan" />
      <input type="hidden" name="key" value={moveKey} />
      <button
        type="submit"
        disabled={pending}
        aria-label={`Put on my plan: ${label}`}
        className={BUTTON}
      >
        Put it on my plan
      </button>
      <FormStatus state={state} />
    </form>
  );
}
