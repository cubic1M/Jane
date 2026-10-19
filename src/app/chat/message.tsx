"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { DemoAdviceLabel } from "@/components/demo-advice-label";
import type { MessageView } from "@/lib/jane-agent/view";
import { tapButton, type MessageState } from "./actions";

// One message in Jane's chat (spec step 81). Jane's sit on the left with their buttons; a
// tap answers it in place, and it shows what was chosen instead of the buttons. Undo stays
// only while it still works. What Jane brings up on her own (a brief, something to
// decide, a heads-up, something done) has a yellow background and a thick yellow left edge;
// her answers to what the person typed stay plain, so the two are never mixed up, with or
// without seeing colour.

const BUTTON = "inline-flex min-h-11 items-center justify-center px-3 text-sm font-semibold";
const STYLES = {
  primary: `${BUTTON} bg-emerald-700 text-white hover:bg-emerald-800 disabled:opacity-60`,
  secondary: `${BUTTON} border border-zinc-400 hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-600 dark:hover:bg-zinc-900`,
  // Spec step 90: a quick reply ("Why?", "Show options"), lighter than a decision.
  quick: `${BUTTON} border border-dashed border-zinc-400 font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-900`,
};
const LINK =
  "inline-flex min-h-11 items-center px-1 text-sm font-medium text-emerald-700 hover:underline";

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
  // Spec step 88: a tap that posted an answer (a clarifying question's button) reloads the
  // chat so the answer shows under it.
  const router = useRouter();
  useEffect(() => {
    if (state.postedAt) router.refresh();
  }, [state.postedAt, router]);
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

  const ownIdea = message.kind !== "reply";

  return (
    // Its id is the anchor notifications open (/chat#<id>, spec step 85).
    <li
      id={message.id}
      data-from={ownIdea ? "jane" : "answer"}
      className={`flex w-full max-w-full scroll-mt-8 flex-col gap-2 self-start border p-3 sm:max-w-[85%] ${
        ownIdea
          ? "border-l-4 border-amber-500 bg-amber-50 dark:border-amber-600 dark:bg-amber-950/40"
          : "border-zinc-300 dark:border-zinc-700"
      }`}
    >
      <p className="flex flex-wrap items-baseline gap-x-2 text-xs text-zinc-500">
        <span className={`font-semibold ${ownIdea ? "text-amber-800" : "text-emerald-700"}`}>
          jane<span aria-hidden="true">&gt;</span>
        </span>
        <span>{message.tag}</span>
        <span aria-hidden="true">·</span>
        <time>{message.time}</time>
      </p>
      <p className="whitespace-pre-line [overflow-wrap:anywhere]">{message.body}</p>
      {/* Spec step 94: a chart, table, timeline or progress bars, drawn in monospace text
          that fits a phone; screen readers get the text alternative instead. */}
      {message.block && (
        <figure className="flex flex-col gap-1 border-l-2 border-zinc-300 pl-2 dark:border-zinc-700">
          <figcaption className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">
            {message.block.title}
          </figcaption>
          <pre
            aria-hidden="true"
            className="overflow-hidden font-mono text-xs leading-5 whitespace-pre"
          >
            {message.block.lines.join("\n")}
          </pre>
          <p className="sr-only">{message.block.alt}</p>
        </figure>
      )}
      {message.advice && <DemoAdviceLabel />}

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
          {message.links.map((link) =>
            // Spec step 83: a company's own page (a cancel page, a sign-up link) opens in a
            // new tab, so the chat stays where it was.
            /^https:\/\//.test(link.href) ? (
              <a
                key={link.href + link.label}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                className={LINK}
              >
                {link.label} ›<span className="sr-only"> (opens in a new tab)</span>
              </a>
            ) : (
              <Link key={link.href + link.label} href={link.href} className={LINK}>
                {link.label} ›
              </Link>
            ),
          )}
        </div>
      )}
    </li>
  );
}
