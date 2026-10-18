"use client";

import { useActionState } from "react";
import { offer, type AnswerState } from "./agent-actions";

// An offer made on one of Jane's calls: the person decides.
export function OfferForm({ actionId }: { actionId: string }) {
  const [state, action, pending] = useActionState<AnswerState, FormData>(offer, null);
  if (state?.ok) {
    return (
      <p role="status" className="text-sm text-emerald-700">
        {state.message}
      </p>
    );
  }
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="actionId" value={actionId} />
      <button
        type="submit"
        name="accept"
        value="yes"
        disabled={pending}
        className="inline-flex h-10 items-center justify-center rounded-full bg-emerald-700 px-5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
      >
        Accept the offer
      </button>
      <button
        type="submit"
        name="accept"
        value="no"
        disabled={pending}
        className="inline-flex h-10 items-center justify-center rounded-full border border-zinc-300 px-5 text-sm font-semibold hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
      >
        No thanks
      </button>
      {state && !state.ok && (
        <p role="alert" className="w-full text-sm text-red-700 dark:text-red-400">
          {state.message}
        </p>
      )}
    </form>
  );
}
