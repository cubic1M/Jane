"use client";

import { useActionState } from "react";
import { documentAction, type FormState } from "./actions";

// On a collected form that doesn't match the accounts (spec step 166): use it as it is, or
// a reminder to ask the payer for a corrected one.
export function DocumentButtons({
  year,
  formKey,
  label,
}: {
  year: number;
  formKey: string;
  label: string;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(documentAction, null);
  const button =
    "inline-flex h-11 items-center rounded-full border border-zinc-400 px-4 text-sm font-medium hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-600 dark:hover:bg-zinc-900";
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="year" value={year} />
      <input type="hidden" name="key" value={formKey} />
      <button
        type="submit"
        name="decision"
        value="right"
        disabled={pending}
        aria-label={`It's right, use it: ${label}`}
        className={button}
      >
        It&apos;s right, use it
      </button>
      <button
        type="submit"
        name="decision"
        value="ask"
        disabled={pending}
        aria-label={`I'll ask them: ${label}`}
        className={button}
      >
        I&apos;ll ask them
      </button>
      <span role="status" className={state?.ok === false ? "text-sm font-semibold" : "text-sm"}>
        {state?.message ?? ""}
      </span>
    </form>
  );
}
