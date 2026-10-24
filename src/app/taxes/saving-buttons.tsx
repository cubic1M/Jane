"use client";

import { useActionState } from "react";
import { savingAction, type FormState } from "./actions";

// A way to pay less on /taxes (spec step 122): its one button, and Not for me.

const BUTTON =
  "inline-flex h-11 items-center justify-center rounded-full px-4 text-sm font-medium disabled:opacity-60";

export function SavingButtons({
  savingKey,
  year,
  kind,
}: {
  savingKey: string;
  year: number;
  kind: "task" | "goal" | "link";
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(savingAction, null);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="key" value={savingKey} />
      <input type="hidden" name="year" value={year} />
      {kind !== "link" && (
        <button
          type="submit"
          name="intent"
          value={kind}
          disabled={pending}
          className={`${BUTTON} bg-zinc-900 text-white hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-300`}
        >
          {kind === "task" ? "Remind me" : "Start a goal for it"}
        </button>
      )}
      <button
        type="submit"
        name="intent"
        value="no"
        disabled={pending}
        className={`${BUTTON} border border-zinc-400 hover:bg-zinc-100 dark:border-zinc-600 dark:hover:bg-zinc-900`}
      >
        Not for me
      </button>
      <span role="status" className={state?.ok === false ? "text-sm font-semibold" : "text-sm"}>
        {state?.message ?? ""}
      </span>
    </form>
  );
}
