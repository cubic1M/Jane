"use client";

import { useState, useTransition } from "react";
import { createCalendarLink, stopCalendar, type CalendarState } from "./actions";

export function CalendarForm({ since }: { since: string | null }) {
  const [state, setState] = useState<CalendarState>(null);
  const [pending, start] = useTransition();
  const on = since !== null || Boolean(state?.link);
  const webcal = state?.link?.replace(/^https?:/, "webcal:");

  return (
    <div className="flex flex-col gap-3">
      <p className="text-zinc-600 dark:text-zinc-400">
        Expected bills, deposits and goal dates in your own calendar app (Google, Apple, Outlook).
        The link is private: it shows merchants, amounts and dates, never account names or numbers.
      </p>
      {since && !state?.link && (
        <p className="text-sm">
          On since {since}. If you lost the link, make a new one; the old one stops working.
        </p>
      )}
      {state && (
        <div role="status" className="flex flex-col gap-2 text-sm">
          <p className={state.ok ? "text-emerald-700" : "text-red-700"}>{state.message}</p>
          {state.link && (
            <>
              <input
                readOnly
                value={state.link}
                aria-label="Calendar link"
                onFocus={(e) => e.currentTarget.select()}
                className="h-10 w-full rounded-lg border border-zinc-300 bg-transparent px-3 text-xs dark:border-zinc-700"
              />
              {webcal && (
                <a
                  href={webcal}
                  className="self-start font-medium text-emerald-700 hover:underline"
                >
                  Add to my calendar app
                </a>
              )}
            </>
          )}
        </div>
      )}
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={pending}
          onClick={() => start(async () => setState(await createCalendarLink()))}
          className="inline-flex h-11 items-center rounded-full bg-emerald-700 px-5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
        >
          {on ? "Make a new link" : "Create my calendar link"}
        </button>
        {on && (
          <button
            type="button"
            disabled={pending}
            onClick={() => start(async () => setState(await stopCalendar()))}
            className="inline-flex h-11 items-center rounded-full border border-zinc-300 px-5 text-sm font-semibold hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            Turn off
          </button>
        )}
      </div>
    </div>
  );
}
