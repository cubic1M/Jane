"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export type ChatMessage = { role: "user" | "assistant"; content: string; blocked?: boolean };

const EXAMPLES = [
  "How much did I spend on food last month?",
  "What bills are coming up this week?",
  "What have you found that could save me money?",
];

export function AskChat({
  conversationId,
  initial,
  maxLength,
}: {
  conversationId: string | null;
  initial: ChatMessage[];
  maxLength: number;
}) {
  const router = useRouter();
  const [messages, setMessages] = useState(initial);
  const [question, setQuestion] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = status !== null;

  async function ask(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setError(null);
    setQuestion("");
    setMessages((current) => [...current, { role: "user", content: trimmed }]);
    setStatus("Thinking…");

    try {
      const response = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversationId, question: trimmed }),
      });
      if (!response.ok || !response.body) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setError(
          response.status === 429
            ? "You've asked a lot this hour. Try again a bit later."
            : (body.error ?? "Something went wrong. Try again."),
        );
        return;
      }
      // One JSON object per line, as they arrive.
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines.filter(Boolean)) {
          const event = JSON.parse(line) as {
            type: string;
            text: string;
            conversationId?: string;
            blocked?: boolean;
          };
          if (event.type === "status") setStatus(event.text);
          if (event.type === "error") setError(event.text);
          if (event.type === "answer") {
            setMessages((current) => [
              ...current,
              { role: "assistant", content: event.text, blocked: event.blocked },
            ]);
            if (!conversationId && event.conversationId) {
              router.replace(`/ask?c=${event.conversationId}`);
            }
          }
        }
      }
    } catch {
      setError("We couldn't reach the server. Try again.");
    } finally {
      setStatus(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {messages.length === 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">Try asking:</p>
          <div className="flex flex-wrap gap-2">
            {EXAMPLES.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => ask(example)}
                className="rounded-full border border-zinc-300 px-3 py-1 text-left text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
              >
                {example}
              </button>
            ))}
          </div>
        </div>
      )}
      <ol aria-label="Conversation" className="flex flex-col gap-3">
        {messages.map((m, i) => (
          <li
            key={i}
            className={
              m.role === "user"
                ? "self-end rounded-2xl bg-emerald-700 px-4 py-2 text-white"
                : "self-start whitespace-pre-wrap rounded-2xl bg-zinc-100 px-4 py-2 dark:bg-zinc-900"
            }
          >
            <span className="sr-only">{m.role === "user" ? "You: " : "Jane: "}</span>
            {m.content}
          </li>
        ))}
      </ol>
      {status && (
        <p role="status" className="text-sm text-zinc-500">
          {status}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void ask(question);
        }}
        className="flex flex-col gap-2 sm:flex-row"
      >
        <label htmlFor="question" className="sr-only">
          Your question
        </label>
        <input
          id="question"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          maxLength={maxLength}
          placeholder="Ask about your money"
          className="h-12 flex-1 rounded-full border border-zinc-300 bg-transparent px-4 dark:border-zinc-700"
        />
        <button
          type="submit"
          disabled={busy || !question.trim()}
          className="h-12 rounded-full bg-emerald-700 px-6 font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
        >
          Ask
        </button>
      </form>
    </div>
  );
}
