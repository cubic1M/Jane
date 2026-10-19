"use client";

import { useActionState } from "react";
import { w4Action, type FormState } from "./actions";

// The withholding checkup's buttons on /taxes (spec step 121).

const BUTTON =
  "inline-flex h-11 items-center justify-center rounded-full px-4 text-sm font-medium disabled:opacity-60";

export function W4Buttons(
  props:
    | { kind: "suggest"; step: string; amountCents: number; year: number; canKeep: boolean }
    | { kind: "undo" },
) {
  const [state, action, pending] = useActionState<FormState, FormData>(w4Action, null);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      {props.kind === "suggest" ? (
        <>
          <input type="hidden" name="step" value={props.step} />
          <input type="hidden" name="amountCents" value={props.amountCents} />
          <input type="hidden" name="year" value={props.year} />
          <button
            type="submit"
            name="intent"
            value="sent"
            disabled={pending}
            className={`${BUTTON} bg-emerald-700 text-white hover:bg-emerald-800`}
          >
            I&apos;ve sent my new W-4
          </button>
          {props.canKeep && (
            <button
              type="submit"
              name="intent"
              value="keep"
              disabled={pending}
              className={`${BUTTON} border border-zinc-400 hover:bg-zinc-100 dark:border-zinc-600 dark:hover:bg-zinc-900`}
            >
              Keep my refund
            </button>
          )}
        </>
      ) : (
        <button
          type="submit"
          name="intent"
          value="undo"
          disabled={pending}
          className={`${BUTTON} border border-zinc-400 hover:bg-zinc-100 dark:border-zinc-600 dark:hover:bg-zinc-900`}
        >
          Undo: I didn&apos;t send it
        </button>
      )}
      <span role="status" className={state?.ok === false ? "text-sm text-red-700" : "text-sm"}>
        {state?.message ?? ""}
      </span>
    </form>
  );
}
