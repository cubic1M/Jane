"use client";

import { useActionState } from "react";
import { saveReply, type ReplyState } from "./actions";

const FIELD =
  "rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-base dark:border-zinc-700";

export function ReplyForm({
  reply,
}: {
  reply: { id: string; title: string; body: string } | null;
}) {
  const [state, action, pending] = useActionState<ReplyState, FormData>(saveReply, null);
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="id" value={reply?.id ?? ""} />
      <label className="flex flex-col gap-1 text-sm font-medium">
        Title (only the team sees it)
        <input name="title" defaultValue={reply?.title ?? ""} className={FIELD} />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Reply (shown to the person as what they need to do)
        <textarea name="body" defaultValue={reply?.body ?? ""} rows={3} className={FIELD} />
      </label>
      {state && (
        <p
          role={state.ok ? "status" : "alert"}
          className={state.ok ? "text-emerald-700" : "text-red-700"}
        >
          {state.message}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="inline-flex h-10 items-center self-start rounded-full bg-emerald-700 px-5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
      >
        {pending ? "Saving…" : reply ? "Save" : "Add reply"}
      </button>
    </form>
  );
}
