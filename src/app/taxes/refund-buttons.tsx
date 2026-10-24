"use client";

import { useActionState } from "react";
import { refundAction, type FormState } from "./actions";

// A tax refund's plan on /taxes (spec step 125).

const BUTTON =
  "inline-flex h-11 items-center justify-center rounded-full px-4 text-sm font-medium disabled:opacity-60";

export function RefundButtons({ transactionId }: { transactionId: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(refundAction, null);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="transactionId" value={transactionId} />
      <button
        type="submit"
        name="intent"
        value="apply"
        disabled={pending}
        className={`${BUTTON} bg-zinc-900 text-white hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-300`}
      >
        Set it up
      </button>
      <button
        type="submit"
        name="intent"
        value="no"
        disabled={pending}
        className={`${BUTTON} border border-zinc-400 hover:bg-zinc-100 dark:border-zinc-600 dark:hover:bg-zinc-900`}
      >
        Not this time
      </button>
      <span role="status" className={state?.ok === false ? "text-sm font-semibold" : "text-sm"}>
        {state?.message ?? ""}
      </span>
    </form>
  );
}
