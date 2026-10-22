"use client";

import Link from "next/link";
import { useActionState, useCallback, useEffect, useRef, useState } from "react";
import type { MessageView } from "@/lib/jane-agent/view";
import { tapButton, type MessageState } from "./actions";

// The day's suggestions as a stack of cards over the chat, one at a time (founder request):
// "1 of 3", Back and Next, a swipe on a phone and the arrow keys on a desktop, so nobody
// scrolls through a list. Each card is the short form (headline, why you, how sure) with Yes,
// Not for me and Why?; they are the same buttons as in the chat, through the same action.
// Closed, the stack is a small "3 suggestions" chip that opens it again. It sits at the end
// of the chat, by the message box, where the page opens to.

const SWIPE_PX = 50;
const BUTTON = "inline-flex min-h-11 items-center justify-center px-3 text-sm font-semibold";
const PRIMARY = `${BUTTON} bg-emerald-700 text-white hover:bg-emerald-800 disabled:opacity-60`;
const SECONDARY = `${BUTTON} border border-zinc-400 hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-600 dark:hover:bg-zinc-900`;
const QUICK = `${BUTTON} border border-dashed border-zinc-400 font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-900`;
const LINK =
  "inline-flex min-h-11 items-center px-1 text-sm font-medium text-emerald-700 hover:underline";

// The card's three lines: headline, "Why you: …" and "85% sure: reason." After Why? the body
// is one paragraph and shows as it is.
export function cardParts(body: string): {
  headline: string;
  why: string | null;
  percent: number | null;
  reason: string | null;
  whole: string | null;
} {
  const lines = body.split("\n");
  const sure = /^(\d{1,3})% sure: (.*?)\.?$/.exec(lines[2] ?? "");
  if (lines.length === 3 && lines[1].startsWith("Why you: ") && sure) {
    return {
      headline: lines[0],
      why: lines[1].slice("Why you: ".length),
      percent: Number(sure[1]),
      reason: sure[2],
      whole: null,
    };
  }
  return { headline: lines[0], why: null, percent: null, reason: null, whole: body };
}

function Card({ initial, onAnswered }: { initial: MessageView; onAnswered: (id: string) => void }) {
  const [state, action, pending] = useActionState<MessageState, FormData>(tapButton, {
    message: initial,
    error: null,
  });
  const [reasonShown, setReasonShown] = useState(false);
  const message = state.message;
  const parts = cardParts(message.body);
  const open = message.status === "open";
  useEffect(() => {
    if (!open) onAnswered(message.id);
  }, [open, message.id, onAnswered]);

  return (
    <article
      aria-label={parts.headline}
      className="flex flex-col gap-2 border-l-4 border-amber-500 bg-amber-50 p-3 dark:border-amber-600 dark:bg-amber-950/40"
    >
      <h3 className="text-base font-semibold [overflow-wrap:anywhere]">{parts.headline}</h3>
      {parts.whole ? (
        <p className="text-sm whitespace-pre-line [overflow-wrap:anywhere]">
          {parts.whole.split("\n").slice(1).join("\n") || parts.whole}
        </p>
      ) : (
        <>
          <p className="text-sm [overflow-wrap:anywhere]">
            <span className="font-medium">Why you:</span> {parts.why}
          </p>
          <div className="flex flex-col items-start gap-1">
            <button
              type="button"
              aria-expanded={reasonShown}
              onClick={() => setReasonShown((v) => !v)}
              className="inline-flex min-h-11 items-center border border-zinc-400 px-2 text-xs font-semibold dark:border-zinc-600"
            >
              {parts.percent}% sure <span aria-hidden="true">{reasonShown ? "▴" : "▾"}</span>
            </button>
            {reasonShown && (
              <p className="text-xs text-zinc-700 dark:text-zinc-300">Based on {parts.reason}.</p>
            )}
          </div>
        </>
      )}
      {message.advice && (
        <p className="text-xs text-zinc-600 dark:text-zinc-400">
          Demo advice: sample data, not financial advice
        </p>
      )}
      {!open && (
        <p role="status" className="text-sm">
          {message.answeredWith ? `You chose: ${message.answeredWith}. ` : ""}
          {message.note ?? ""}
        </p>
      )}
      {state.error && (
        <p role="alert" className="text-sm text-red-700">
          {state.error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {open && message.buttons.length > 0 && (
          <form action={action} className="flex flex-wrap gap-2">
            <input type="hidden" name="messageId" value={message.id} />
            {message.buttons.map((b) => (
              <button
                key={b.id}
                type="submit"
                name="actionId"
                value={b.id}
                disabled={pending}
                className={b.kind === "primary" ? PRIMARY : b.kind === "quick" ? QUICK : SECONDARY}
              >
                {b.label}
              </button>
            ))}
          </form>
        )}
        {message.links.map((link) => (
          <Link key={link.href + link.label} href={link.href} className={LINK}>
            {link.label} ›
          </Link>
        ))}
      </div>
    </article>
  );
}

export function SuggestionStack({ messages }: { messages: MessageView[] }) {
  const [index, setIndex] = useState(0);
  const [shown, setShown] = useState(true);
  const [answered, setAnswered] = useState<ReadonlySet<string>>(new Set());
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const total = messages.length;
  const waiting = messages.filter((m) => !answered.has(m.id)).length;
  const go = (to: number) => setIndex(Math.max(0, Math.min(total - 1, to)));

  // Arrow keys move through the cards while the stack is open, unless they're typing.
  useEffect(() => {
    if (!shown) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (target?.isContentEditable) return;
      if (event.key === "ArrowRight") setIndex((i) => Math.min(total - 1, i + 1));
      else if (event.key === "ArrowLeft") setIndex((i) => Math.max(0, i - 1));
      else if (event.key === "Escape") setShown(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shown, total]);

  const markAnswered = useCallback(
    (id: string) =>
      setAnswered((current) => (current.has(id) ? current : new Set(current).add(id))),
    [],
  );

  if (total === 0) return null;
  if (!shown) {
    return (
      <button
        type="button"
        onClick={() => setShown(true)}
        className="inline-flex min-h-11 items-center self-start bg-emerald-700 px-4 text-sm font-semibold text-white hover:bg-emerald-800"
      >
        {waiting} suggestion{waiting === 1 ? "" : "s"}
      </button>
    );
  }
  const current = messages[Math.min(index, total - 1)];

  return (
    <section
      aria-label="Suggestions for you"
      onTouchStart={(e) => {
        const t = e.touches[0];
        touchStart.current = { x: t.clientX, y: t.clientY };
      }}
      onTouchEnd={(e) => {
        const start = touchStart.current;
        touchStart.current = null;
        if (!start) return;
        const t = e.changedTouches[0];
        const dx = t.clientX - start.x;
        // A mostly sideways swipe moves a card; a scroll doesn't.
        if (Math.abs(dx) >= SWIPE_PX && Math.abs(dx) > Math.abs(t.clientY - start.y) * 1.5) {
          go(index + (dx < 0 ? 1 : -1));
        }
      }}
      className="flex w-full flex-col gap-2 border-2 border-emerald-700 bg-white p-3 dark:bg-zinc-950"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Suggestions for you</h2>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => go(index - 1)}
            disabled={index <= 0}
            aria-label="Previous suggestion"
            className="inline-flex min-h-11 min-w-11 items-center justify-center border border-zinc-400 text-sm disabled:opacity-40 dark:border-zinc-600"
          >
            <span aria-hidden="true">←</span>
          </button>
          <p aria-live="polite" className="min-w-16 text-center text-sm tabular-nums">
            {Math.min(index, total - 1) + 1} of {total}
          </p>
          <button
            type="button"
            onClick={() => go(index + 1)}
            disabled={index >= total - 1}
            aria-label="Next suggestion"
            className="inline-flex min-h-11 min-w-11 items-center justify-center border border-zinc-400 text-sm disabled:opacity-40 dark:border-zinc-600"
          >
            <span aria-hidden="true">→</span>
          </button>
          <button
            type="button"
            onClick={() => setShown(false)}
            className="inline-flex min-h-11 items-center px-2 text-sm font-medium text-zinc-700 hover:underline dark:text-zinc-300"
          >
            Hide
          </button>
        </div>
      </div>
      <Card key={current.id} initial={current} onAnswered={markAnswered} />
    </section>
  );
}
