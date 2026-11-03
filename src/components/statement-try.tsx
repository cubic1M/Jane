"use client";

import { useActionState, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { UPLOAD_REASSURANCE } from "@/config/import";
import {
  STATEMENT_TRIAL_MAX_FILE_BYTES,
  TRIAL_DELETED_WITHIN_HOURS,
  statementTooBig,
} from "@/config/statement-trial";
import { forgetThisTry } from "@/lib/forget-try";
import type { TryState } from "@/app/try/actions";
import { tryWithStatement } from "@/app/try/statement-actions";
import { TermsTick } from "@/components/terms-tick";

// "Try it with your own statement" on the landing page. /?try=upload opens it directly, which is
// the link to share; /?try=upload&deleted=1 is where "Start over" lands. Read in the browser, so
// the landing page itself stays the same for everyone.
const noChange = () => () => {};
const search = () => window.location.search;
const onServer = () => "";

export function StatementTry() {
  const params = useSyncExternalStore(noChange, search, onServer);
  const opened = new URLSearchParams(params).get("try") === "upload";
  const deleted = new URLSearchParams(params).get("deleted") === "1";
  const [state, action, pending] = useActionState<TryState, FormData>(tryWithStatement, null);
  const next = state && "next" in state ? state.next : null;
  const box = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    if (opened) box.current?.scrollIntoView({ block: "center" });
  }, [opened]);
  // A plain page load, never a soft navigation: nothing of an earlier try stays in memory.
  useEffect(() => {
    if (!next) return;
    forgetThisTry();
    window.location.assign(next);
  }, [next]);

  // Past the size, said here: the file is never sent.
  const [tooBig, setTooBig] = useState(false);
  function checkSize(event: React.FormEvent<HTMLFormElement>) {
    const file = new FormData(event.currentTarget).get("file");
    const over = file instanceof File && file.size > STATEMENT_TRIAL_MAX_FILE_BYTES;
    setTooBig(over);
    if (over) event.preventDefault();
  }

  return (
    <details
      ref={box}
      id="try-upload"
      open={opened || undefined}
      className="w-full max-w-md min-w-0 border border-dashed border-[var(--landing-dot)] p-4"
    >
      <summary className="cursor-pointer font-semibold text-[var(--landing-hi)]">
        Try it with your own statement
      </summary>
      <form action={action} onSubmit={checkSize} className="mt-3 flex min-w-0 flex-col gap-3">
        {deleted && (
          <p role="status" data-try-deleted="" className="text-sm text-[var(--landing-hi)]">
            Deleted. Your statement&apos;s data is gone from Jane.
          </p>
        )}
        <p className="text-sm text-[var(--landing-mid)]">
          No email, no account. {UPLOAD_REASSURANCE} What Jane reads is deleted when you start over,
          or within {TRIAL_DELETED_WITHIN_HOURS} hours. Starting again deletes your last try in this
          browser.
        </p>
        <TermsTick />
        <label className="flex min-w-0 flex-col gap-1 text-sm text-[var(--landing-mid)]">
          Your statement (CSV, OFX or QFX)
          <input
            name="file"
            type="file"
            required
            accept=".csv,.ofx,.qfx,text/csv,application/x-ofx"
            className="w-full min-w-0 text-sm text-[var(--landing-hi)] file:mr-3 file:border file:border-[var(--landing-dot)] file:bg-transparent file:px-3 file:py-2 file:text-[var(--landing-hi)]"
          />
        </label>
        <button
          type="submit"
          disabled={pending || next !== null}
          className="inline-flex h-12 items-center justify-center border border-[var(--landing-hi)] px-6 text-base font-semibold text-[var(--landing-hi)] transition-colors hover:bg-[var(--landing-hi)] hover:text-[var(--landing-bg)] disabled:opacity-60"
        >
          {pending || next !== null ? "Reading your statement…" : "Read my statement"}
        </button>
        {(tooBig || (state && "error" in state)) && (
          <p role="alert" className="text-sm text-[var(--landing-hi)]">
            {tooBig ? statementTooBig() : state && "error" in state && state.error}
          </p>
        )}
      </form>
    </details>
  );
}
