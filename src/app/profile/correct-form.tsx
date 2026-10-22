"use client";

import { useActionState } from "react";
import { correctProfileFact, type CorrectState } from "./actions";

// One fact's correction box: the answer is typed (or yes/no, or one of the choices).
export function CorrectForm({
  factKey,
  choices,
  placeholder,
}: {
  factKey: string;
  choices?: readonly string[];
  placeholder: string;
}) {
  const [state, action, pending] = useActionState<CorrectState, FormData>(correctProfileFact, null);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="key" value={factKey} />
      <label className="sr-only" htmlFor={`answer-${factKey}`}>
        Correct this
      </label>
      {choices ? (
        <select
          id={`answer-${factKey}`}
          name="answer"
          className="h-10 rounded-lg border border-zinc-300 bg-white px-2 dark:border-zinc-700 dark:bg-zinc-900"
        >
          {choices.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={`answer-${factKey}`}
          name="answer"
          placeholder={placeholder}
          className="h-10 w-40 rounded-lg border border-zinc-300 bg-white px-3 dark:border-zinc-700 dark:bg-zinc-900"
        />
      )}
      <button
        type="submit"
        disabled={pending}
        className="h-10 rounded-full border border-emerald-700 px-4 text-sm font-semibold text-emerald-800 disabled:opacity-60 dark:text-emerald-300"
      >
        Correct
      </button>
      {state?.key === factKey && (
        <span
          role="status"
          className={state.ok ? "text-sm text-emerald-700" : "text-sm text-red-700"}
        >
          {state.message}
        </span>
      )}
    </form>
  );
}
