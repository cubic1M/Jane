"use client";

import { useActionState } from "react";
import { cancelled, type AnswerState } from "./agent-actions";

// For companies that only cancel from the account holder's own page.
export function SelfCancel({
  actionId,
  company,
  url,
}: {
  actionId: string;
  company: string;
  url: string;
}) {
  const [state, action, pending] = useActionState<AnswerState, FormData>(cancelled, null);
  if (state?.ok) {
    return (
      <p role="status" className="text-sm text-emerald-700">
        {state.message}
      </p>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex h-10 items-center justify-center rounded-full bg-emerald-700 px-5 text-sm font-semibold text-white hover:bg-emerald-800"
      >
        Open {company}&apos;s cancel page
      </a>
      <form action={action}>
        <input type="hidden" name="actionId" value={actionId} />
        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-10 items-center justify-center rounded-full border border-zinc-300 px-5 text-sm font-semibold hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
        >
          I&apos;ve cancelled it
        </button>
      </form>
      {state && !state.ok && (
        <p role="alert" className="w-full text-sm text-red-700 dark:text-red-400">
          {state.message}
        </p>
      )}
    </div>
  );
}
