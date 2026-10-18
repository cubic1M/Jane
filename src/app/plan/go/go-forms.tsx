"use client";

import { useActionState } from "react";
import { goAhead, takeBack, type GoState } from "./actions";

const PRIMARY =
  "inline-flex h-12 items-center justify-center rounded-full bg-emerald-700 px-6 font-semibold text-white hover:bg-emerald-800 disabled:opacity-50";
const SECONDARY =
  "inline-flex h-11 items-center justify-center rounded-full border border-zinc-300 px-5 font-semibold hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900";

function Result({ state }: { state: GoState }) {
  if (!state) return null;
  return (
    <p
      role={state.ok ? "status" : "alert"}
      className={state.ok ? "text-emerald-700" : "text-red-700 dark:text-red-400"}
    >
      {state.message}
    </p>
  );
}

export function GoAheadForm({ token, count }: { token: string; count: number }) {
  const [state, action, pending] = useActionState<GoState, FormData>(goAhead, null);
  if (state?.ok) return <Result state={state} />;
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="token" value={token} />
      <button type="submit" disabled={pending} className={PRIMARY}>
        {pending ? "Starting…" : `Go ahead with ${count}`}
      </button>
      <Result state={state} />
    </form>
  );
}

export function TakeBackForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState<GoState, FormData>(takeBack, null);
  if (state?.ok) return <Result state={state} />;
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="token" value={token} />
      <button type="submit" disabled={pending} className={SECONDARY}>
        Take it back
      </button>
      <Result state={state} />
    </form>
  );
}
