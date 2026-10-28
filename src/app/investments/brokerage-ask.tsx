"use client";

import { useState, useTransition } from "react";
import { IMPORT_STARTED_EVENT } from "@/config/import";
import { askQuestion } from "@/lib/investing/apps";
import { setBrokerageBalanceAction } from "./brokerage-actions";

// "What's in your Robinhood account today?": one field for an investing app money went to, so net
// worth can count it. Skipping is fine (src/lib/investing/brokerage-balance.ts).

const FIELD =
  "h-11 w-40 rounded-lg border border-zinc-300 bg-transparent px-3 text-base dark:border-zinc-700";
const BUTTON =
  "inline-flex h-11 items-center rounded-full border border-zinc-300 px-5 text-sm font-semibold hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900";

export function BrokerageAskForm({ app, sentText }: { app: string; sentText: string }) {
  const [state, setState] = useState<"asking" | "saved" | "skipped">("asking");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  if (state === "skipped") return null;
  if (state === "saved") {
    return (
      <p role="status" className="text-sm">
        Saved. Jane is updating your net worth.
      </p>
    );
  }
  const question = askQuestion(app);
  return (
    <form
      data-brokerage-ask={app}
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const text = String(new FormData(event.currentTarget).get("balance") ?? "");
        setError(null);
        startTransition(async () => {
          const result = await setBrokerageBalanceAction(app, text);
          if (!result.ok) return setError(result.error);
          setState("saved");
          window.dispatchEvent(new CustomEvent(IMPORT_STARTED_EVENT));
        });
      }}
    >
      <label className="flex flex-col gap-1 text-sm font-semibold">
        {question}
        <span className="text-xs font-normal text-zinc-600 dark:text-zinc-400">
          {sentText} Your statements show money going in, not what it grew to, so net worth
          can&apos;t count it until you say.
        </span>
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <input
          name="balance"
          inputMode="decimal"
          required
          placeholder="1,234.56"
          aria-label={question}
          className={FIELD}
        />
        <button type="submit" disabled={pending} className={BUTTON}>
          {pending ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => setState("skipped")}
          className="text-sm text-zinc-600 underline dark:text-zinc-400"
        >
          Skip for now
        </button>
      </div>
      {error && (
        <p role="alert" className="text-sm font-medium">
          {error}
        </p>
      )}
    </form>
  );
}
