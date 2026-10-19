"use client";

import { useActionState } from "react";
import { confirmReply, type ReplyState } from "./actions";

// The one button on the confirm page (spec step 85), in the chat's ASCII style.

export function ReplyForm({ token, label }: { token: string; label: string }) {
  const [state, action, pending] = useActionState<ReplyState, FormData>(confirmReply, null);
  if (state?.ok) {
    return (
      <p role="status" className="text-emerald-700">
        <span aria-hidden="true">&gt; </span>
        {state.message}
      </p>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="token" value={token} />
      <button
        type="submit"
        disabled={pending}
        className="inline-flex min-h-12 items-center justify-center self-start bg-emerald-700 px-6 font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
      >
        <span aria-hidden="true">[</span>
        {pending ? "Sending…" : label}
        <span aria-hidden="true">]</span>
      </button>
      {state && (
        <p role="alert" className="text-red-700 dark:text-red-400">
          {state.message}
        </p>
      )}
    </form>
  );
}
