"use client";

import { useState, useTransition } from "react";
import { keepSeparateAction, undoSeparateAction } from "./actions";

// An uploaded account net worth leaves out because it may be a copy of a linked one, or of an earlier
// upload (src/planning/books.ts accountsLeftOut): the words, and one tap to say it is an account of
// its own, which counts it from then on. Below, the ones already said to be separate, with an undo.
const BUTTON =
  "inline-flex h-10 items-center rounded-full border border-zinc-300 px-4 text-sm font-semibold hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900";

export function LeftOutAccount({
  accountId,
  words,
  separate,
}: {
  accountId: string;
  words: string;
  // Already said to be an account of its own: the button takes that back.
  separate: boolean;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const tap = () =>
    start(async () => {
      const result = await (separate ? undoSeparateAction : keepSeparateAction)(accountId);
      setError(result.ok ? null : result.error);
    });
  return (
    <li data-left-out={accountId} className="flex flex-col gap-2">
      <p>{words}</p>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={tap} disabled={pending} className={BUTTON}>
          {separate ? "Count it as a copy again" : "This is a different account"}
        </button>
        {error && (
          <span role="alert" className="text-sm font-medium">
            {error}
          </span>
        )}
      </div>
    </li>
  );
}
