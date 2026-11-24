"use client";

import { useState, useTransition } from "react";
import { flushSync } from "react-dom";
import { closeBooksNote } from "@/app/home/actions";

// A note with a close button at its top right, when it has a key to be remembered by (Home's
// "figures rely on data I'm still checking" box). It goes on the tap and the server hears in the
// background; if that fails, it comes back with one line saying so. Without a key it's just a note.
export function ClosableNote({
  closeKey,
  className,
  children,
}: {
  closeKey?: string;
  className: string;
  children: React.ReactNode;
}) {
  const [closed, setClosed] = useState(false);
  const [failed, setFailed] = useState(false);
  const [, startTransition] = useTransition();
  if (closed) return null;
  return (
    <aside role="note" className={`${className} ${closeKey ? "relative pr-12" : ""}`}>
      {children}
      {failed && <p role="alert">Couldn&apos;t close it just now. Try again.</p>}
      {closeKey && (
        <button
          type="button"
          aria-label="Close this note"
          onClick={() => {
            flushSync(() => {
              setClosed(true);
              setFailed(false);
            });
            startTransition(async () => {
              try {
                await closeBooksNote(closeKey);
              } catch {
                setClosed(false);
                setFailed(true);
              }
            });
          }}
          className="absolute top-0 right-0 inline-flex size-11 items-center justify-center text-lg"
        >
          <span aria-hidden="true">×</span>
        </button>
      )}
    </aside>
  );
}
