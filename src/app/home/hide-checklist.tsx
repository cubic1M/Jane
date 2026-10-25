"use client";

import { useState, useTransition } from "react";
import { flushSync } from "react-dom";
import { hideChecklist } from "./actions";

// "Hide this for good" (founder: "if you click hide this for good, it should be instant"): the
// list goes on the tap and the server hears in the background; if it fails, the list comes back
// with one line saying so.
export function HideableChecklist({ children }: { children: React.ReactNode }) {
  const [hidden, setHidden] = useState(false);
  const [failed, setFailed] = useState(false);
  const [, startTransition] = useTransition();

  if (hidden) return null;
  return (
    <section
      aria-labelledby="checklist-heading"
      className="flex flex-col gap-3 border border-zinc-300 p-4 dark:border-zinc-700"
    >
      {children}
      {failed && (
        <p role="alert" className="text-sm">
          Couldn&apos;t hide it just now. Try again.
        </p>
      )}
      <button
        type="button"
        onClick={() => {
          // Gone in this frame (QA round 12: it took about half a second), before the server
          // is even asked.
          flushSync(() => {
            setHidden(true);
            setFailed(false);
          });
          startTransition(async () => {
            try {
              await hideChecklist();
            } catch {
              setHidden(false);
              setFailed(true);
            }
          });
        }}
        className="inline-flex min-h-11 items-center self-start text-sm text-zinc-600 hover:underline dark:text-zinc-400"
      >
        Hide this for good
      </button>
    </section>
  );
}
