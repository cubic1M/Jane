"use client";

import { useActionState } from "react";
import { markForm, type FormState } from "./actions";

// "I have it" / "Not yet" on one tax form (spec step 119).
export function FormToggle({
  year,
  formKey,
  received,
  label,
}: {
  year: number;
  formKey: string;
  received: boolean;
  label: string;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(markForm, null);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="year" value={year} />
      <input type="hidden" name="key" value={formKey} />
      <input type="hidden" name="received" value={received ? "0" : "1"} />
      <button
        type="submit"
        disabled={pending}
        aria-label={`${received ? "Not yet" : "I have it"}: ${label}`}
        className="inline-flex h-11 items-center rounded-full border border-zinc-400 px-4 text-sm font-medium hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-600 dark:hover:bg-zinc-900"
      >
        {received ? "Not yet" : "I have it"}
      </button>
      <span role="status" className={state?.ok === false ? "text-sm text-red-700" : "text-sm"}>
        {state?.message ?? ""}
      </span>
    </form>
  );
}
