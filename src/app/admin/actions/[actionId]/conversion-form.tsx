"use client";

import { useActionState } from "react";
import { recordConversion, type ConversionState } from "./actions";

export function ConversionForm({ actionId, suggested }: { actionId: string; suggested: string }) {
  const [state, action, pending] = useActionState<ConversionState, FormData>(
    recordConversion,
    null,
  );
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="actionId" value={actionId} />
      <label className="flex flex-col gap-1 text-xs font-medium">
        Partner paid ($)
        <input
          name="amount"
          defaultValue={suggested}
          className="h-10 w-28 rounded-lg border border-zinc-300 bg-transparent px-3 text-sm dark:border-zinc-700"
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="h-10 rounded-full border border-zinc-300 px-4 text-sm font-semibold hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
      >
        Record conversion
      </button>
      {state && (
        <p
          role={state.ok ? "status" : "alert"}
          className={`text-sm ${state.ok ? "text-emerald-700" : "text-red-700"}`}
        >
          {state.message}
        </p>
      )}
    </form>
  );
}
