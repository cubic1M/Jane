"use client";

import { useActionState } from "react";
import { submitCode, type MfaState } from "./actions";

export function CodeForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<MfaState, FormData>(submitCode, null);
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="next" value={next} />
      <label className="flex flex-col gap-1 text-sm font-medium">
        6-digit code
        <input
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 ]{6,7}"
          required
          className="h-12 rounded-lg border border-zinc-300 bg-transparent px-3 text-lg tracking-widest dark:border-zinc-700"
        />
      </label>
      {state && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {state.message}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="inline-flex h-11 items-center justify-center rounded-full bg-emerald-700 px-6 font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
      >
        {pending ? "Checking…" : "Continue"}
      </button>
    </form>
  );
}
