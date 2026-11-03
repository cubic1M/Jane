"use client";

import { useEffect, useState, useTransition } from "react";
import { startOverTry } from "@/app/try/statement-actions";
import { forgetThisTry } from "@/lib/forget-try";

// "Start over" on a temporary try's banner: deletes the person now, what this tab kept of them
// too, then a plain page load back to the landing page's upload.
export function StartOverButton() {
  const [pending, start] = useTransition();
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!next) return;
    forgetThisTry();
    window.location.assign(next);
  }, [next]);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        data-start-over-try=""
        disabled={pending || next !== null}
        onClick={() => {
          setError(null);
          start(async () => {
            const result = await startOverTry().catch(() => null);
            if (result && "next" in result) setNext(result.next);
            else setError(result?.error ?? "That didn't go through. Please try again.");
          });
        }}
        className="min-h-11 font-semibold underline disabled:opacity-60"
      >
        {pending || next !== null ? "Deleting…" : "Start over"}
      </button>
      {error && <span role="alert">{error}</span>}
    </span>
  );
}
