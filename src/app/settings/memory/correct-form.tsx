"use client";

import { useActionState } from "react";
import { correctMemoryFact, type CorrectMemoryState } from "./actions";

// One fact's correction: yes or no, one of the choices, or the person's own words.
export function CorrectMemoryForm({
  factId,
  label,
  choices,
}: {
  factId: string;
  label: string;
  choices?: readonly string[];
}) {
  const [state, action, pending] = useActionState<CorrectMemoryState, FormData>(
    correctMemoryFact,
    null,
  );
  const field = `answer-${factId}`;
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="factId" value={factId} />
      <label className="sr-only" htmlFor={field}>
        Correct: {label}
      </label>
      {choices ? (
        <select
          id={field}
          name="answer"
          className="h-10 rounded-lg border border-zinc-300 bg-white px-2 dark:border-zinc-700 dark:bg-zinc-900"
        >
          {choices.map((c) => (
            <option key={c} value={c}>
              {c.replace(/_/g, " ")}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={field}
          name="answer"
          required
          maxLength={80}
          placeholder="What's right"
          className="h-10 w-48 rounded-lg border border-zinc-300 bg-white px-3 dark:border-zinc-700 dark:bg-zinc-900"
        />
      )}
      <button
        type="submit"
        disabled={pending}
        className="h-10 rounded-full border border-zinc-900 px-4 text-sm font-semibold disabled:opacity-60 dark:border-zinc-100"
      >
        Save
      </button>
      {state?.id === factId && (
        <span
          role="status"
          className={
            state.ok
              ? "text-sm text-zinc-600 dark:text-zinc-400"
              : "border-l-4 border-zinc-900 pl-2 text-sm font-semibold dark:border-zinc-100"
          }
        >
          {state.ok ? state.message : `[ERROR] ${state.message}`}
        </span>
      )}
    </form>
  );
}
