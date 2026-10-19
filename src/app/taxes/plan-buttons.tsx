"use client";

import { useActionState } from "react";
import { planAction, type FormState } from "./actions";

// "Add to my deadlines" / "Not for me" on one tax move (spec step 167).
export function PlanButtons({ moveId, label }: { moveId: string; label: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(planAction, null);
  const button =
    "inline-flex h-11 items-center rounded-full border border-zinc-400 px-4 text-sm font-medium hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-600 dark:hover:bg-zinc-900";
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="move" value={moveId} />
      <button
        type="submit"
        name="intent"
        value="add"
        disabled={pending}
        aria-label={`Add to my deadlines: ${label}`}
        className={button}
      >
        Add to my deadlines
      </button>
      <button
        type="submit"
        name="intent"
        value="no"
        disabled={pending}
        aria-label={`Not for me: ${label}`}
        className={button}
      >
        Not for me
      </button>
      <span role="status" className={state?.ok === false ? "text-sm text-red-700" : "text-sm"}>
        {state?.message ?? ""}
      </span>
    </form>
  );
}
