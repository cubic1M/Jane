"use client";

import { useActionState } from "react";
import { give, type GiftState } from "./actions";

const INPUT =
  "h-11 min-w-0 rounded-lg border border-zinc-300 bg-transparent px-3 text-base dark:border-zinc-700";

export function GiftForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState<GiftState, FormData>(
    give.bind(null, token),
    null,
  );
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      <label htmlFor="gift-name" className="flex flex-col gap-1 text-sm font-medium">
        Your name
        <input id="gift-name" name="name" className={INPUT} autoComplete="name" />
      </label>
      <label htmlFor="gift-amount" className="flex flex-col gap-1 text-sm font-medium">
        Amount ($)
        <input id="gift-amount" name="amount" inputMode="decimal" className={INPUT} />
      </label>
      {state && (
        <p role="alert" className="text-sm text-red-700 sm:col-span-2">
          {state.message}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="h-11 self-start rounded-lg bg-emerald-700 px-5 font-medium text-white hover:bg-emerald-800 disabled:opacity-60"
      >
        Give
      </button>
    </form>
  );
}
