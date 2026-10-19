"use client";

import { useActionState, useEffect, useRef } from "react";
import { sendMessage, type SendState } from "./send";

// The message box at the bottom of Jane's chat (spec step 84). Sends what the person typed;
// the chat refreshes with it and Jane's answer underneath, and the box clears and stays at
// the end. Its scroll margin is as tall as the phone tab bar, so the bar never covers it.

export function ChatComposer({ id, maxLength }: { id: string; maxLength: number }) {
  const [state, action, pending] = useActionState<SendState, FormData>(sendMessage, {
    error: null,
    sentAt: 0,
  });
  const form = useRef<HTMLFormElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (state.sentAt === 0) return;
    form.current?.reset();
    input.current?.focus();
    form.current?.scrollIntoView({ block: "end" });
  }, [state.sentAt]);

  return (
    <form
      id={id}
      ref={form}
      action={action}
      className="flex scroll-mb-[calc(4.5rem+env(safe-area-inset-bottom))] flex-col gap-1 sm:scroll-mb-4"
    >
      <div className="flex min-h-12 items-center gap-2 border border-zinc-400 px-3 focus-within:border-emerald-700 dark:border-zinc-600">
        <span aria-hidden="true" className="text-emerald-700">
          &gt;
        </span>
        <input
          ref={input}
          name="message"
          type="text"
          required
          maxLength={maxLength}
          autoComplete="off"
          enterKeyHint="send"
          aria-label="Message Jane"
          placeholder="Ask Jane anything"
          disabled={pending}
          className="min-h-11 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-zinc-500 disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={pending}
          className="inline-flex min-h-11 shrink-0 items-center px-1 text-sm font-semibold text-emerald-700 hover:underline disabled:opacity-60"
        >
          <span aria-hidden="true">[</span>
          {pending ? "Sending…" : "Send"}
          <span aria-hidden="true">]</span>
        </button>
      </div>
      {pending && (
        <p role="status" className="text-sm text-zinc-500">
          Jane is looking…
        </p>
      )}
      {state.error && !pending && (
        <p role="alert" className="text-sm text-red-700">
          {state.error}
        </p>
      )}
    </form>
  );
}
