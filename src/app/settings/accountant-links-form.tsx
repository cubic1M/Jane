"use client";

import { useState, useTransition } from "react";
import { stopAccountantLinks, type CalendarState } from "./actions";

// A link for an accountant, made before that page was hidden, can still be stopped from here.
export function AccountantLinksForm({ live }: { live: number }) {
  const [state, setState] = useState<CalendarState>(null);
  const [pending, start] = useTransition();
  if (live === 0 && !state) return null;
  return (
    <div className="flex flex-col gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
      {state ? (
        <p role="status" className="text-sm">
          {state.message}
        </p>
      ) : (
        <>
          <p className="text-sm">
            {live === 1 ? "One link" : `${live} links`} for an accountant can still read your tax
            information and write to you here.
          </p>
          <button
            type="button"
            disabled={pending}
            onClick={() => start(async () => setState(await stopAccountantLinks()))}
            className="self-start text-sm font-medium underline disabled:opacity-50"
          >
            Stop {live === 1 ? "it" : "them"}
          </button>
        </>
      )}
    </div>
  );
}
