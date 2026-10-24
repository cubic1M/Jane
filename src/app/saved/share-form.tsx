"use client";

import { useActionState } from "react";
import { shareTotal, stopSharing, type ShareState } from "./actions";
import { SubmitButton } from "@/components/submit-button";

const BUTTON =
  "inline-flex min-h-11 items-center justify-center rounded-full px-5 text-sm font-semibold disabled:opacity-60";

// Share the confirmed total, or take every shared link down (spec step 139).
export function ShareForm() {
  const [state, share, sharing] = useActionState<ShareState>(shareTotal, null);
  const [stopped, stop, stopping] = useActionState<ShareState>(stopSharing, null);
  const shown = stopped ?? state;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-3">
        <form action={share}>
          <SubmitButton
            disabled={sharing}
            className={`${BUTTON} bg-emerald-700 text-white hover:bg-emerald-800`}
          >
            Share my total
          </SubmitButton>
        </form>
        <form action={stop}>
          <SubmitButton
            disabled={stopping}
            className={`${BUTTON} border border-zinc-400 hover:bg-zinc-100 dark:border-zinc-600 dark:hover:bg-zinc-900`}
          >
            Stop sharing
          </SubmitButton>
        </form>
      </div>
      {shown && (
        <p role="status" className="text-sm [overflow-wrap:anywhere]">
          {shown.message}
          {shown.link && (
            <>
              {" "}
              <a href={shown.link} className="font-medium text-emerald-700 hover:underline">
                {typeof window === "undefined"
                  ? shown.link
                  : `${window.location.origin}${shown.link}`}
              </a>
            </>
          )}
        </p>
      )}
    </div>
  );
}
