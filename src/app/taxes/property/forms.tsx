"use client";

import { useActionState } from "react";
import { propertyAction, type PropertyState } from "./actions";
import { FormStatus } from "@/components/form-status";

const INPUT =
  "h-11 rounded-lg border border-zinc-300 bg-white px-3 text-base dark:border-zinc-700 dark:bg-zinc-950";
const BUTTON =
  "inline-flex h-11 items-center justify-center self-start rounded-full bg-emerald-700 px-5 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-60";
const SECONDARY =
  "inline-flex h-11 items-center justify-center self-start rounded-full border border-zinc-300 px-5 text-sm font-medium hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-900";

type Facts = {
  market: string;
  assessed: string;
  assessedYear: string;
  noticeOn: string;
  age: string;
  veteran: string;
  disabled: string;
};

function Field({
  name,
  label,
  value,
  hint,
}: {
  name: string;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm">{label}</span>
      <input name={name} defaultValue={value} inputMode="decimal" className={INPUT} />
      {hint && <span className="text-xs text-zinc-600 dark:text-zinc-400">{hint}</span>}
    </label>
  );
}

function Choice({ name, label, value }: { name: string; label: string; value: string }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm">{label}</span>
      <select name={name} defaultValue={value} className={INPUT}>
        <option value="">Not saying</option>
        <option value="yes">Yes</option>
        <option value="no">No</option>
      </select>
    </label>
  );
}

export function AnswersForm({ facts }: { facts: Facts }) {
  const [state, action, pending] = useActionState<PropertyState, FormData>(propertyAction, null);
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="intent" value="answers" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field name="market" label="What your home would sell for ($)" value={facts.market} />
        <Field name="assessed" label="What the county assessed it at ($)" value={facts.assessed} />
        <Field name="assessedYear" label="Assessment year" value={facts.assessedYear} />
        <label className="flex flex-col gap-1">
          <span className="text-sm">Date the assessment notice was mailed</span>
          <input type="date" name="noticeOn" defaultValue={facts.noticeOn} className={INPUT} />
          <span className="text-xs text-zinc-600 dark:text-zinc-400">
            Some counties count your appeal days from it.
          </span>
        </label>
        <Field name="age" label="Your age" value={facts.age} />
        <Choice name="veteran" label="Did you serve in the military?" value={facts.veteran} />
        <Choice
          name="disabled"
          label="Do you have a service-connected disability?"
          value={facts.disabled}
        />
      </div>
      <button type="submit" disabled={pending} className={BUTTON}>
        Save
      </button>
      <FormStatus state={state} />
    </form>
  );
}

export function IntentButton({
  intent,
  label,
  secondary,
  keyValue,
  aria,
}: {
  intent: string;
  label: string;
  secondary?: boolean;
  keyValue?: string;
  aria?: string;
}) {
  const [state, action, pending] = useActionState<PropertyState, FormData>(propertyAction, null);
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="intent" value={intent} />
      {keyValue && <input type="hidden" name="key" value={keyValue} />}
      <button
        type="submit"
        disabled={pending}
        aria-label={aria}
        className={secondary ? SECONDARY : BUTTON}
      >
        {label}
      </button>
      <FormStatus state={state} />
    </form>
  );
}
