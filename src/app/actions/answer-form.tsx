"use client";

import { useActionState } from "react";
import { answer, type AnswerState } from "./agent-actions";

export function AnswerForm({ actionId }: { actionId: string }) {
  const [state, action, pending] = useActionState<AnswerState, FormData>(answer, null);
  if (state?.ok) {
    return (
      <p role="status" className="text-sm text-emerald-700">
        {state.message}
      </p>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="actionId" value={actionId} />
      <label className="flex flex-col gap-1 text-sm font-medium">
        Your answer (Jane sends it to them)
        <textarea
          name="answer"
          rows={2}
          maxLength={1000}
          required
          className="rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-base dark:border-zinc-700"
        />
      </label>
      <p className="text-xs text-zinc-600 dark:text-zinc-400">
        Never include full card or account numbers, or passwords.
      </p>
      <button
        type="submit"
        disabled={pending}
        className="inline-flex h-10 w-fit items-center justify-center rounded-full bg-emerald-700 px-5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
      >
        {pending ? "Sending…" : "Send answer"}
      </button>
      {state && !state.ok && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {state.message}
        </p>
      )}
    </form>
  );
}
