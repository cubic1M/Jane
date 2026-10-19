"use client";

import { useActionState } from "react";
import { rebalanceNow, type RebalanceState } from "./actions";

export function RebalanceButton({ planKey }: { planKey: string }) {
  const [state, action, pending] = useActionState<RebalanceState, FormData>(rebalanceNow, null);
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="key" value={planKey} />
      <button
        type="submit"
        disabled={pending}
        className="h-11 self-start rounded-lg bg-emerald-700 px-5 font-medium text-white hover:bg-emerald-800 disabled:opacity-60"
      >
        Move to the recommended mix (simulated)
      </button>
      {state && (
        <p role="alert" className="text-sm text-red-700">
          {state.message}
        </p>
      )}
    </form>
  );
}
