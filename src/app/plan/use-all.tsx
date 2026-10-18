"use client";

import { useActionState } from "react";
import { acceptSuggestions, type ProposalState } from "./actions";

// One tap for all of Jane's budget and goal suggestions (spec step 63).
export function UseAllSuggestions({ count }: { count: number }) {
  const [state, action, pending] = useActionState<ProposalState, FormData>(acceptSuggestions, null);
  if (state?.ok) {
    return (
      <p role="status" className="text-emerald-700">
        {state.message} Reload to see them on your budgets and goals.
      </p>
    );
  }
  return (
    <form action={action}>
      <button
        type="submit"
        disabled={pending}
        className="inline-flex h-11 items-center justify-center rounded-full bg-emerald-700 px-6 font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
      >
        {pending ? "Setting up…" : `Use Jane's ${count} suggestions`}
      </button>
    </form>
  );
}
