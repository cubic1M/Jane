"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { clearChatAction, type ClearChatState } from "./clear";

// The "Clear chat" control at the top of the chat, in the side panel and on a phone: one tap asks,
// a second deletes (founder 11-28). The words say exactly what happens.
export const CLEAR_CHAT_WARNING =
  "This deletes every message in this chat for good, including pinned answers. What Jane knows about you stays.";

export function ClearChat() {
  // The state's clearedAt when the question was opened: once the chat is cleared it moves on, and
  // the question closes by itself.
  const [openedFor, setOpenedFor] = useState<number | null>(null);
  const router = useRouter();
  const [state, action, pending] = useActionState<ClearChatState, FormData>(clearChatAction, {
    error: null,
    clearedAt: 0,
  });
  // Cleared: the chat is read again from the server, and starts empty.
  useEffect(() => {
    if (state.clearedAt === 0) return;
    router.refresh();
  }, [state.clearedAt, router]);

  const asking = openedFor === state.clearedAt;
  if (!asking) {
    return (
      <div data-clear-chat className="flex flex-col items-end gap-1">
        <button
          type="button"
          onClick={() => setOpenedFor(state.clearedAt)}
          className="inline-flex min-h-11 items-center px-2 text-sm font-medium text-zinc-600 underline-offset-2 hover:underline dark:text-zinc-400"
        >
          Clear chat
        </button>
        {state.error && (
          <p role="alert" className="text-sm">
            {state.error}
          </p>
        )}
      </div>
    );
  }
  return (
    <form
      action={action}
      data-clear-chat
      role="group"
      aria-label="Clear chat"
      className="flex flex-col gap-2 rounded-xl border border-zinc-300 p-3 text-sm dark:border-zinc-700"
    >
      <input type="hidden" name="confirm" value="yes" />
      <p>{CLEAR_CHAT_WARNING}</p>
      {state.error && (
        <p role="alert" className="font-medium">
          {state.error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex min-h-11 items-center rounded-lg bg-zinc-900 px-4 font-medium text-white dark:bg-zinc-100 dark:text-zinc-900 disabled:opacity-60"
        >
          {pending ? "Deleting…" : "Delete every message"}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => setOpenedFor(null)}
          className="inline-flex min-h-11 items-center rounded-lg border border-zinc-300 px-4 font-medium dark:border-zinc-700"
        >
          Keep chat
        </button>
      </div>
    </form>
  );
}
