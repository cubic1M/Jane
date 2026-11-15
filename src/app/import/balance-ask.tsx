"use client";

import { useRef, useState, useTransition } from "react";
import { setBalanceAction } from "./actions";
import { IMPORT_STARTED_EVENT } from "@/config/import";
import { balanceQuestion, type BalanceAsk } from "@/lib/import/balance-question";

// "What do you owe on Chase card today?": one field for an uploaded account whose file has no
// balance (cards, Wells Fargo), so net worth can count it. Skipping is fine; net worth then says
// what it isn't counting (src/lib/import/account-balance.ts).

const FIELD =
  "h-11 w-40 rounded-lg border border-zinc-300 bg-transparent px-3 text-base dark:border-zinc-700";
const BUTTON =
  "inline-flex h-11 items-center rounded-full border border-zinc-300 px-5 text-sm font-semibold hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900";

export function BalanceAskForm({
  ask,
  skippable = true,
  explain = true,
}: {
  ask: BalanceAsk;
  skippable?: boolean;
  // Why it's asked, unless the page has said it once above a list of them.
  explain?: boolean;
}) {
  const [state, setState] = useState<"asking" | "saved" | "skipped">("asking");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const field = useRef<HTMLInputElement>(null);
  if (state === "skipped") return null;
  if (state === "saved") {
    return (
      <p role="status" className="text-sm">
        Saved. Jane is updating your net worth.
      </p>
    );
  }
  const question = balanceQuestion(ask);
  function save() {
    const text = field.current?.value ?? "";
    setError(null);
    startTransition(async () => {
      const result = await setBalanceAction(ask.accountId, text);
      if (!result.ok) return setError(result.error);
      setState("saved");
      // The chip follows the numbers being worked out again.
      window.dispatchEvent(new CustomEvent(IMPORT_STARTED_EVENT));
    });
  }
  // Not a form of its own: right after an upload it sits inside the upload's form, and a form in a
  // form is no form at all, so Save sent the page to /import?balance=… and saved nothing
  // (debugger 11-15). Enter saves, as it would in a form.
  return (
    <div
      role="group"
      aria-label={question}
      data-balance-ask={ask.accountId}
      className="flex flex-col gap-2"
    >
      <label className="flex flex-col gap-1 text-sm font-semibold">
        {question}
        {explain && (
          <span className="text-xs font-normal text-zinc-600 dark:text-zinc-400">
            {ask.kind === "credit_card"
              ? "The statement doesn't say, so net worth can't count this card's debt until you do."
              : "The statement doesn't say, so net worth can't count this account until you do."}
          </span>
        )}
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={field}
          inputMode="decimal"
          placeholder="1,234.56"
          aria-label={question}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            save();
          }}
          className={FIELD}
        />
        <button type="button" disabled={pending} onClick={save} className={BUTTON}>
          {pending ? "Saving…" : "Save"}
        </button>
        {skippable && (
          <button
            type="button"
            disabled={pending}
            onClick={() => setState("skipped")}
            className="text-sm text-zinc-600 underline dark:text-zinc-400"
          >
            Skip for now
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm font-medium">
          {error}
        </p>
      )}
    </div>
  );
}
