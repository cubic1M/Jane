"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { MicButton } from "./mic-button";
import { sendMessage, type SendState } from "./send";

// The message box at the bottom of Jane's chat (spec step 84). What the person typed shows
// at once, then what Jane is looking up and her answer as it's written (streamed from
// /api/chat/send). When she's done, the chat reloads with both messages as stored, buttons
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
  // (a refresh while Jane writes her answer) isn't shown a second time.
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
    if (!question || pending || sending.current) return;
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
        className="flex scroll-mb-[calc(1rem+env(safe-area-inset-bottom))] flex-col gap-1"
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
          <MicButton
            disabled={pending}
            onStatus={setHeard}
            onText={(text, final) => {
              if (!input.current) return;
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
