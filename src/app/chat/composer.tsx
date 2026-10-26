"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { flushSync } from "react-dom";
import { MicButton } from "./mic-button";
import { sendMessage, type SendState } from "./send";

// The message box at the bottom of Jane's chat (spec step 84). What the person typed shows
// at once, then what Jane is looking up and its answer as it's written (streamed from
// /api/chat/send). When it's done, the chat reloads with both messages as stored, buttons
// and all, and the box clears and stays at the end. Without JavaScript the form's server
// action sends it instead. Its scroll margin is as tall as the phone tab bar, so the bar
// never covers it.

type Draft = {
  question: string;
  // The ids of the messages on the page when it was typed.
  before: Set<string>;
  status: string | null;
  answer: string;
};

type StreamLine =
  | { type: "status"; text: string }
  | { type: "text"; text: string }
  | { type: "reset" }
  | { type: "done" }
  | { type: "error"; text: string };

const FAILED = "Something went wrong. Try again.";

export function ChatComposer({
  id,
  maxLength,
  typed = [],
}: {
  id: string;
  maxLength: number;
  // The person's own messages on the page, so a typed question that is already stored there
  // (a refresh while Jane writes its answer) isn't shown a second time.
  typed?: { id: string; body: string }[];
}) {
  const [state, action, actionPending] = useActionState<SendState, FormData>(sendMessage, {
    error: null,
    sentAt: 0,
  });
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Spec step 186: what the microphone is doing, said for screen readers and shown.
  const [heard, setHeard] = useState("");
  const [refreshing, startRefresh] = useTransition();
  const form = useRef<HTMLFormElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const pending = actionPending || draft !== null || refreshing;
  // Spec step 194: a second tap or Enter in the same instant never sends it twice.
  const sending = useRef(false);
  // A question put in the box for the person to finish (the home hub's "I'm aiming to spend $"),
  // with a greyed hint after it ("[amount] on [what]") until they type; never sent. In a box too
  // narrow for both (the docked panel, a phone), the hint goes on its own line just under it.
  const [hint, setHint] = useState<{ text: string; hint: string; under: boolean } | null>(null);
  const hintLine = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const onHint = (event: Event) => {
      const d = (event as CustomEvent<{ text: string; hint: string | null }>).detail;
      if (!d?.hint) return setHint(null);
      // Drawn after the text first; cut off there, it moves under the box.
      flushSync(() => setHint({ text: d.text, hint: d.hint!, under: false }));
      const drawn = hintLine.current;
      if (drawn && drawn.scrollWidth > drawn.clientWidth + 1)
        setHint((h) => h && { ...h, under: true });
    };
    window.addEventListener("jane:hint", onHint);
    return () => window.removeEventListener("jane:hint", onHint);
  }, []);

  useEffect(() => {
    if (state.sentAt === 0) return;
    form.current?.reset();
    input.current?.focus();
    form.current?.scrollIntoView({ block: "end" });
  }, [state.sentAt]);

  // Back to the box once the answer is in (it can't take focus while it's disabled).
  const sent = useRef(false);
  useEffect(() => {
    if (pending || !sent.current) return;
    sent.current = false;
    input.current?.focus();
  }, [pending]);

  // Keep the answer in view as it grows.
  useEffect(() => {
    if (draft) form.current?.scrollIntoView({ block: "end" });
  }, [draft]);

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const question = input.current?.value.trim() ?? "";
    // Left as it was put there, the sentence isn't finished: the box keeps it to type into.
    if (hint && input.current?.value === hint.text) {
      input.current.focus();
      return;
    }
    if (!question || pending || sending.current) return;
    setHint(null);
    sending.current = true;
    setError(null);
    setHeard("");
    sent.current = true;
    setDraft({ question, before: new Set(typed.map((m) => m.id)), status: null, answer: "" });
    form.current?.reset();

    const fail = (text: string) => {
      sending.current = false;
      setDraft(null);
      setError(text);
      if (input.current) input.current.value = question;
    };
    let response: Response;
    try {
      response = await fetch("/api/chat/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: question }),
      });
    } catch {
      return fail(FAILED);
    }
    if (!response.ok || !response.body) {
      // Signed out, or the Terms changed: the page itself sends them where they need to go.
      if (response.status === 401 || response.status === 403) return router.refresh();
      return fail(FAILED);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finished = false;
    while (!finished) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines.filter(Boolean)) {
        const event = JSON.parse(line) as StreamLine;
        if (event.type === "status") {
          setDraft((d) => d && { ...d, status: event.text });
        } else if (event.type === "text") {
          setDraft((d) => d && { ...d, status: null, answer: d.answer + event.text });
        } else if (event.type === "reset") {
          setDraft((d) => d && { ...d, answer: "" });
        } else if (event.type === "error") {
          return fail(event.text);
        } else {
          finished = true;
        }
      }
    }
    if (!finished) return fail(FAILED);
    // The stored messages replace the draft in the same render.
    sending.current = false;
    startRefresh(() => {
      router.refresh();
      setDraft(null);
    });
  }

  const shownError = error ?? (actionPending ? null : state.error);

  // How tall the pinned box is, so the cards over the chat sit just above it.
  useEffect(() => {
    const el = form.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const root = document.documentElement;
    const watch = new ResizeObserver(() =>
      root.style.setProperty("--chat-composer-h", `${Math.round(el.offsetHeight)}px`),
    );
    watch.observe(el);
    // Whatever is scrolled into view (a reply's buttons, a found message) stops above the box
    // and the cards over it, never under them.
    root.style.scrollPaddingBottom =
      "calc(var(--chat-composer-h, 5.5rem) + var(--floating-cards-h, 0px) + 1rem)";
    return () => {
      watch.disconnect();
      root.style.removeProperty("--chat-composer-h");
      root.style.removeProperty("scroll-padding-bottom");
    };
  }, []);

  return (
    <>
      {draft && (
        <div aria-label="Sending" className="flex flex-col gap-4">
          {!typed.some((m) => !draft.before.has(m.id) && m.body === draft.question) && (
            <div className="flex flex-col items-end gap-1 self-end sm:max-w-[80%]">
              <span className="text-xs text-zinc-500">You</span>
              <p
                data-draft-question=""
                className="bg-emerald-700 px-3 py-2 whitespace-pre-line text-white [overflow-wrap:anywhere]"
              >
                {draft.question}
              </p>
            </div>
          )}
          <div className="flex w-full max-w-full flex-col gap-2 self-start border border-zinc-300 p-3 sm:max-w-[85%] dark:border-zinc-700">
            <p className="text-xs text-zinc-500">
              <span className="font-semibold text-emerald-700">jane&gt;</span> answer
            </p>
            {draft.answer && (
              <p data-draft-answer="" className="whitespace-pre-line [overflow-wrap:anywhere]">
                {draft.answer}
              </p>
            )}
            {(draft.status || !draft.answer) && (
              <p role="status" className="text-sm text-zinc-500">
                {draft.status ?? "Jane is looking…"}
                <span aria-hidden="true" className="ascii-cursor">
                  _
                </span>
              </p>
            )}
          </div>
        </div>
      )}
      <form
        id={id}
        ref={form}
        action={action}
        onSubmit={send}
        // Pinned to the bottom edge (founder: "the place to type is fixed at the bottom right,
        // and not leaving a blank space down below"): pushed down when the chat is short, held
        // there when it scrolls.
        data-chat-composer=""
        className="sticky bottom-0 z-30 mt-auto -mx-4 flex flex-col gap-1 bg-white px-4 pt-2 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:-mx-6 sm:px-6 dark:bg-zinc-950"
      >
        <div className="flex min-h-12 items-center gap-2 border border-zinc-400 px-3 focus-within:border-emerald-700 dark:border-zinc-600">
          <span aria-hidden="true" className="text-emerald-700">
            &gt;
          </span>
          <div className="relative flex min-w-0 flex-1">
            <input
              ref={input}
              name="message"
              type="text"
              required
              maxLength={maxLength}
              autoComplete="off"
              enterKeyHint="send"
              aria-label="Message Jane"
              aria-describedby={hint ? `${id}-hint` : undefined}
              placeholder="Ask Jane anything"
              disabled={pending}
              onInput={(e) => {
                if (hint && e.currentTarget.value !== hint.text) setHint(null);
              }}
              className="min-h-11 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-zinc-500 disabled:opacity-60"
            />
            {hint && !hint.under && (
              // Drawn over the box just after the text: the text itself invisible, to measure.
              <span
                ref={hintLine}
                id={`${id}-hint`}
                data-composer-hint=""
                className="pointer-events-none absolute inset-0 flex items-center overflow-hidden text-base whitespace-pre"
              >
                <span aria-hidden="true" className="invisible">
                  {hint.text}
                </span>
                <span className="text-zinc-400 dark:text-zinc-500">{hint.hint}</span>
              </span>
            )}
          </div>
          <MicButton
            disabled={pending}
            onStatus={setHeard}
            onText={(text, final) => {
              if (!input.current) return;
              setHint(null);
              input.current.value = text.slice(0, maxLength);
              if (final) input.current.focus();
            }}
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
        {hint?.under && (
          <p
            id={`${id}-hint`}
            data-composer-hint=""
            className="pl-6 text-sm text-zinc-400 dark:text-zinc-500"
          >
            {hint.text.slice(-1)}
            {hint.hint}
          </p>
        )}
        {heard && !pending && (
          <p role="status" className="text-sm text-zinc-500">
            {heard}
          </p>
        )}
        {actionPending && (
          <p role="status" className="text-sm text-zinc-500">
            Jane is looking…
          </p>
        )}
        {shownError && !pending && (
          <p role="alert" className="flex flex-wrap items-center gap-x-3 text-sm text-red-700">
            {shownError}
            {/* Spec step 194: a plain error with a way to try again; the words are still in
                the box. */}
            <button
              type="button"
              onClick={() => form.current?.requestSubmit()}
              className="inline-flex min-h-11 items-center font-semibold underline"
            >
              Try again
            </button>
          </p>
        )}
      </form>
    </>
  );
}
