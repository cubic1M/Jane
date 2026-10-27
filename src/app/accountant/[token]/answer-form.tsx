"use client";

import { useActionState } from "react";
import { answerAction, type AnswerState } from "./actions";
import { FormStatus } from "@/components/form-status";

const INPUT =
  "rounded-lg border border-zinc-300 bg-white px-3 py-2 text-base dark:border-zinc-700 dark:bg-zinc-950";

export function AnswerForm({
  token,
  questionKey,
  label,
}: {
  token: string;
  questionKey: string | null;
  label: string;
}) {
  const [state, action, pending] = useActionState<AnswerState, FormData>(answerAction, null);
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="questionKey" value={questionKey ?? ""} />
      <label className="flex flex-col gap-1">
        <span className="text-sm">{label}</span>
        <textarea name="body" rows={3} maxLength={2000} className={INPUT} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-sm">Your name</span>
        <input name="name" maxLength={80} className={`${INPUT} h-11`} />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="inline-flex h-11 items-center justify-center self-start rounded-full bg-emerald-700 px-5 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-60"
      >
        Send
      </button>
      <FormStatus state={state} />
    </form>
  );
}
