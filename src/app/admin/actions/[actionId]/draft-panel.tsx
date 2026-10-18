"use client";

import { useActionState, useState } from "react";
import { draftForAction, type DraftState } from "./actions";

export function DraftPanel({ actionId }: { actionId: string }) {
  const [state, action, pending] = useActionState<DraftState, FormData>(draftForAction, null);
  const [copied, setCopied] = useState(false);

  const text =
    state?.ok === true
      ? [state.draft.subject && `Subject: ${state.draft.subject}`, state.draft.body]
          .filter(Boolean)
          .join("\n\n")
      : "";

  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-semibold">Message to the merchant</h2>
      <form action={action}>
        <input type="hidden" name="actionId" value={actionId} />
        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-10 items-center rounded-full border border-zinc-300 px-4 text-sm font-semibold hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
        >
          {pending ? "Drafting…" : state?.ok ? "Draft again" : "Draft a message"}
        </button>
      </form>
      {state?.ok === false && (
        <p role="alert" className="text-sm text-red-700">
          {state.message}
        </p>
      )}
      {state?.ok === true && (
        <>
          <p className="text-xs text-zinc-500">
            {state.draft.channel === "call" ? "Call script" : "Email"},{" "}
            {state.byClaude ? "drafted by Claude" : "standard wording"}. Fill in the [brackets] and
            check it before sending.
          </p>
          <pre className="whitespace-pre-wrap rounded-xl border border-zinc-200 p-4 font-sans text-sm dark:border-zinc-800">
            {text}
          </pre>
          <button
            type="button"
            onClick={async () => {
              await navigator.clipboard.writeText(text);
              setCopied(true);
            }}
            className="self-start text-sm font-medium text-emerald-700 hover:underline"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </>
      )}
    </section>
  );
}
