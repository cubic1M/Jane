"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useOptimistic, useState } from "react";
import { DemoAdviceLabel } from "@/components/demo-advice-label";
import { concise } from "@/lib/jane-agent/popups";
import type { MessageView } from "@/lib/jane-agent/view";
import {
  DONE_ACTION,
  REVERT_ACTION,
  chosenView,
  isChoice,
  revertedView,
} from "@/lib/jane-agent/choices";
import { tapButton, type MessageState } from "./actions";
import { ReadAloud } from "./read-aloud";
import { togglePin } from "./pin";
import { SubmitButton } from "@/components/submit-button";

// One message in Jane's chat (spec step 81). Jane's sit on the left. What it brings up on its
// own that waits on the person floats as a pop-up (src/lib/jane-agent/popups.ts) and isn't in
// the list until it's answered; then it's one line of history (what it was and what was
// chosen, the whole message behind More details), with Undo while it still works. Its briefs
// and answers are plain text tagged "jane>": no cards in the list.

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

// What a tap looks like before the server has answered: answered with that button, its
// buttons gone (links stay), and a line saying it's in hand.
function tappedView(current: MessageView, tapped: MessageView["buttons"][number]): MessageView {
  // A choice stays, marked, with Revert; Revert brings the choices back (founder, 2026-10-25).
  if (isChoice(tapped.id)) return chosenView(current, tapped);
  if (tapped.id === REVERT_ACTION) return revertedView(current);
  return {
    ...current,
    status: "answered",
    answeredWith: tapped.label,
    note: tapped.kind === "primary" ? "Done: Jane's on it." : "Got it.",
    buttons: [],
  };
}

export function ChatMessageItem({ initial }: { initial: MessageView }) {
  const [state, action, pending] = useActionState<MessageState, FormData>(tapButton, {
    message: initial,
    error: null,
  });
  // A tap shows its result at once (the button gives way to what was chosen); the server's
  // answer replaces it when it arrives, and a refusal puts the buttons back with its reason.
  const [message, showTapped] = useOptimistic(state.message, tappedView);
  // Spec step 88: a tap that posted an answer (a clarifying question's button) reloads the
  // chat so the answer shows under it.
  const router = useRouter();
  useEffect(() => {
    if (state.postedAt) router.refresh();
  }, [state.postedAt, router]);
  // A tap shows its result before the server has saved it: leaving or reloading in that
  // moment would lose the choice, so the browser asks first.
  useEffect(() => {
    if (!pending) return;
    const keep = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", keep);
    return () => window.removeEventListener("beforeunload", keep);
  }, [pending]);
  const undoExpired = useUndoTimer(message.undoUntil);
  // Done belongs to the floating card; in the chat a choice keeps Revert alone.
  const buttons = message.buttons.filter(
    (b) => !(undoExpired && b.id.startsWith("undo.")) && b.id !== DONE_ACTION,
  );

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
  // A pop-up that was answered or put away: history, in one line.
  const history = ownIdea && message.status !== "open";

  return (
    // Its id is the anchor notifications open (/chat#<id>, spec step 85).
    <li
      id={message.id}
      data-from={ownIdea ? "jane" : "answer"}
      data-history={history || undefined}
      className={`flex w-full max-w-full scroll-mt-8 flex-col self-start sm:max-w-[85%] ${
        history ? "gap-1 py-1" : "gap-2 border border-zinc-300 p-3 dark:border-zinc-700"
      }`}
    >
      <p className="flex flex-wrap items-baseline gap-x-2 text-xs text-zinc-500">
        <span className="font-semibold text-zinc-950 dark:text-zinc-50">
          jane<span aria-hidden="true">&gt;</span>
        </span>
        <span>{message.tag}</span>
        <span aria-hidden="true">·</span>
        <time>{message.time}</time>
      </p>
      {history ? (
        <details className="text-sm">
          <summary className="cursor-pointer [overflow-wrap:anywhere]">
            {concise(message.body)}
            <span className="sr-only"> More details</span>
          </summary>
          <p className="mt-1 whitespace-pre-line text-zinc-700 [overflow-wrap:anywhere] dark:text-zinc-300">
            {message.body}
          </p>
        </details>
      ) : (
        <p className="whitespace-pre-line [overflow-wrap:anywhere]">{message.body}</p>
      )}
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

      <div className="-mb-2 flex items-center gap-2 self-end">
        {/* Spec step 186: read it aloud, on request. */}
        <ReadAloud parts={[message.body, message.block?.alt, message.note]} />
        {/* Spec step 96: pin it to the top of the chat, or unpin it. */}
        <form action={togglePin}>
          <input type="hidden" name="messageId" value={message.id} />
          <input type="hidden" name="pinned" value={message.pinned ? "false" : "true"} />
          <SubmitButton className="inline-flex min-h-11 items-center px-1 text-xs font-medium text-zinc-500 hover:underline">
            {message.pinned ? "Unpin" : "Pin"}
          </SubmitButton>
        </form>
      </div>
      {/* A choice that was made: every choice still here, the chosen one inverted and marked,
          the others greyed and off (founder, 2026-10-25); Revert is among the buttons. */}
      {message.chosen && message.chosen.choices.length > 0 && (
        <div
          role="group"
          aria-label="Your choice"
          data-chosen-choices=""
          className="flex flex-wrap gap-2"
        >
          {message.chosen.choices.map((c) =>
            c.key === message.chosen!.key ? (
              <button
                key={c.key}
                type="button"
                disabled
                aria-pressed="true"
                className="inline-flex min-h-11 items-center gap-1 border-2 border-zinc-950 bg-zinc-950 px-3 text-sm font-semibold text-white dark:border-white dark:bg-white dark:text-zinc-950"
              >
                {c.label} <span aria-hidden="true">[✓ chosen]</span>
                <span className="sr-only">, chosen</span>
              </button>
            ) : (
              <button
                key={c.key}
                type="button"
                disabled
                aria-pressed="false"
                className="inline-flex min-h-11 items-center border border-zinc-400 px-3 text-sm opacity-40 dark:border-zinc-600"
              >
                {c.label}
              </button>
            ),
          )}
        </div>
      )}
      {(buttons.length > 0 || message.links.length > 0) && (
        <div className="flex flex-wrap items-center gap-2">
          {buttons.length > 0 && (
            <form
              action={(data) => {
                const tapped = buttons.find((b) => b.id === data.get("actionId"));
                if (tapped) showTapped(tapped);
                return action(data);
              }}
              className="flex flex-wrap gap-2"
            >
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
              // Spec step 194: a plain link, so it works before the page has hydrated and
              // isn't cancelled by the refreshes that bring in new messages.
              <a key={link.href + link.label} href={link.href} className={LINK}>
                {link.label} ›
              </a>
            ),
          )}
        </div>
      )}
    </li>
  );
}
