"use client";

import { useActionState } from "react";
import { disasterAction, type DisasterState } from "./actions";

const BUTTON =
  "inline-flex h-11 items-center justify-center self-start rounded-full bg-emerald-700 px-5 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-60";
const SECOND =
  "inline-flex h-11 items-center justify-center self-start rounded-full border border-zinc-400 px-5 text-sm font-medium hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-600 dark:hover:bg-zinc-900";

export function ReliefButtons({
  relief,
  canMove,
  canRecord,
}: {
  relief: string;
  canMove: boolean;
  canRecord: boolean;
}) {
  const [state, action, pending] = useActionState<DisasterState, FormData>(disasterAction, null);
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="relief" value={relief} />
      {canMove && (
        <button type="submit" name="intent" value="move" disabled={pending} className={BUTTON}>
          Move my tax deadlines
        </button>
      )}
      {canRecord && (
        <button type="submit" name="intent" value="loss" disabled={pending} className={SECOND}>
          Keep the loss with my claim
        </button>
      )}
      <p
        role="status"
        className={
          state ? (state.ok ? "text-sm text-emerald-800" : "text-sm text-red-700") : "sr-only"
        }
      >
        {state?.message ?? ""}
      </p>
    </form>
  );
}
