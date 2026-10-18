"use client";

import { useActionState } from "react";
import { saveCallOffers, type AutopilotState } from "./autopilot-actions";

export function CallOffersForm({ accept }: { accept: boolean }) {
  const [state, action, pending] = useActionState<AutopilotState, FormData>(saveCallOffers, null);
  return (
    <form action={action} className="flex flex-col gap-2">
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          name="accept"
          defaultChecked={accept}
          className="mt-1 size-5 shrink-0"
        />
        <span className="flex flex-col">
          <span className="font-medium">
            On bill calls, accept any lower price with no contract and no fee
          </span>
          <span className="text-sm text-zinc-600 dark:text-zinc-400">
            Even on a different plan of the same service. Anything with a contract or a fee still
            comes to you.
          </span>
        </span>
      </label>
      <button
        type="submit"
        disabled={pending}
        className="inline-flex h-10 w-fit items-center justify-center rounded-full border border-zinc-300 px-5 text-sm font-semibold hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
      >
        Save
      </button>
      {state && (
        <p role="status" className="text-sm text-emerald-700">
          {state.message}
        </p>
      )}
    </form>
  );
}
