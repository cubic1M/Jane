"use client";

import { useActionState } from "react";
import { givingAction, type FormState } from "./actions";

// One giving button on /taxes (spec step 168): a gift's receipt, or a donor-advised fund.
export function GivingButton({
  intent,
  gift,
  label,
  ariaLabel,
}: {
  intent: "receipt" | "fund";
  gift?: string;
  label: string;
  ariaLabel: string;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(givingAction, null);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="intent" value={intent} />
      {gift && <input type="hidden" name="gift" value={gift} />}
      <button
        type="submit"
        disabled={pending}
        aria-label={ariaLabel}
        className="inline-flex h-11 items-center self-start rounded-full border border-zinc-400 px-4 text-sm font-medium hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-600 dark:hover:bg-zinc-900"
      >
        {label}
      </button>
      <span role="status" className={state?.ok === false ? "text-sm font-semibold" : "text-sm"}>
        {state?.message ?? ""}
      </span>
    </form>
  );
}
