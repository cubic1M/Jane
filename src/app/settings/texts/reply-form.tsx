"use client";

import { useActionState } from "react";
import { simulateTextReply, type TextsState } from "../texts-actions";

export function ReplyForm() {
  const [state, action, pending] = useActionState<TextsState, FormData>(simulateTextReply, null);
  return (
    <form action={action} className="flex flex-col gap-2">
      <label className="flex flex-col gap-1 text-sm font-medium">
        Reply as your phone
        <span className="flex gap-2">
          <input
            name="content"
            placeholder="YES, 1 3, NO, UNDO, STOP, START or HELP"
            maxLength={500}
            required
            className="h-11 min-w-0 flex-1 rounded-lg border border-zinc-300 bg-transparent px-3 text-base dark:border-zinc-700"
          />
          <button
            type="submit"
            disabled={pending}
            className="inline-flex h-11 shrink-0 items-center justify-center rounded-full bg-emerald-700 px-5 font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
          >
            Send
          </button>
        </span>
      </label>
      {state && (
        <p
          role={state.ok ? "status" : "alert"}
          className={state.ok ? "text-sm text-emerald-700" : "text-sm text-red-700"}
        >
          {state.message}
        </p>
      )}
    </form>
  );
}
