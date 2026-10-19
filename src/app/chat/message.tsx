"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import type { MessageView } from "@/lib/jane-agent/view";
import { tapButton, type MessageState } from "./actions";

// One message in Jane's chat (spec step 81). Jane's sit on the left with their buttons; a
// tap answers it in place, and it shows what was chosen instead of the buttons. Undo stays
// only while it still works.

const BUTTON = "inline-flex min-h-11 items-center justify-center px-3 text-sm font-semibold";
const STYLES = {
  primary: `${BUTTON} bg-emerald-700 text-white hover:bg-emerald-800 disabled:opacity-60`,
  secondary: `${BUTTON} border border-zinc-400 hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-600 dark:hover:bg-zinc-900`,
};

function Brackets({ children }: { children: React.ReactNode }) {
  return (
    <>
      <span aria-hidden="true">[</span>
      {children}
      <span aria-hidden="true">]</span>
    </>
  );
}

// Hides Undo once its time is up, without a reload.
function useUndoTimer(undoUntil: string | null): boolean {
  // The Undo deadline that has passed, if any.
  const [expiredAt, setExpiredAt] = useState<string | null>(null);
  useEffect(() => {
    if (!undoUntil) return;
    const ms = Math.max(0, new Date(undoUntil).getTime() - Date.now());
    const timer = setTimeout(() => setExpiredAt(undoUntil), ms);
    return () => clearTimeout(timer);
  }, [undoUntil]);
  return undoUntil !== null && expiredAt === undoUntil;
}

export function ChatMessageItem({ initial }: { initial: MessageView }) {
  const [state, action, pending] = useActionState<MessageState, FormData>(tapButton, {
    message: initial,
    error: null,
  });
  const message = state.message;
  const undoExpired = useUndoTimer(message.undoUntil);
  const buttons = message.buttons.filter((b) => !(undoExpired && b.id.startsWith("undo.")));

  if (!message.fromJane) {
    return (
      <li className="flex flex-col items-end gap-1 self-end sm:max-w-[80%]">
        <span className="text-xs text-zinc-500">
          <span className="sr-only">You, </span>
          {message.time}
        </span>
        <p className="bg-emerald-700 px-3 py-2 whitespace-pre-line text-white [overflow-wrap:anywhere]">
          {message.body}
        </p>
      </li>
    );
  }

  return (
    <li className="flex w-full max-w-full flex-col gap-2 self-start border border-zinc-300 p-3 sm:max-w-[85%] dark:border-zinc-700">
      <p className="flex flex-wrap items-baseline gap-x-2 text-xs text-zinc-500">
        <span className="font-semibold text-emerald-700">
          jane<span aria-hidden="true">&gt;</span>
        </span>
        <span>{message.tag}</span>
        <span aria-hidden="true">·</span>
        <time>{message.time}</time>
      </p>
      <p className="whitespace-pre-line [overflow-wrap:anywhere]">{message.body}</p>

      {message.status !== "open" && (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {message.answeredWith ? (
            <>
              <span aria-hidden="true">&gt; </span>
              You chose: <strong>{message.answeredWith}</strong>
            </>
          ) : message.status === "answered" ? (
            "Already answered."
          ) : (
            "Dismissed."
          )}
        </p>
      )}
      {message.note && (
        <p role="status" className="text-sm">
          {message.note}
        </p>
      )}
      {state.error && (
        <p role="alert" className="text-sm text-red-700">
          {state.error}
        </p>
      )}

      {(buttons.length > 0 || message.links.length > 0) && (
        <div className="flex flex-wrap items-center gap-2">
          {buttons.length > 0 && (
            <form action={action} className="flex flex-wrap gap-2">
              <input type="hidden" name="messageId" value={message.id} />
              {buttons.map((b) => (
                <button
                  key={b.id}
                  type="submit"
                  name="actionId"
                  value={b.id}
                  disabled={pending}
                  className={STYLES[b.kind]}
                >
                  <Brackets>{b.label}</Brackets>
                </button>
              ))}
            </form>
          )}
          {message.links.map((link) => (
            <Link
              key={link.href + link.label}
              href={link.href}
              className="inline-flex min-h-11 items-center px-1 text-sm font-medium text-emerald-700 hover:underline"
            >
              {link.label} ›
            </Link>
          ))}
        </div>
      )}
    </li>
  );
}
