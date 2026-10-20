"use client";

import { useActionState } from "react";
import { recordsAction, type FormState } from "./actions";

// "Remind me" before a year's records can be thrown away (spec step 171).
export function RecordsButton({ year }: { year: number }) {
  const [state, action, pending] = useActionState<FormState, FormData>(recordsAction, null);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="year" value={year} />
      <button
        type="submit"
        disabled={pending}
        aria-label={`Remind me about my ${year} records`}
        className="inline-flex h-11 items-center rounded-full border border-zinc-400 px-4 text-sm font-medium hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-600 dark:hover:bg-zinc-900"
      >
        Remind me
      </button>
      <span role="status" className={state?.ok === false ? "text-sm text-red-700" : "text-sm"}>
        {state?.message ?? ""}
      </span>
    </form>
  );
}
