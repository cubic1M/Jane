"use client";

import { useActionState } from "react";
import { fileAction, type FileState } from "./actions";
import { FormStatus } from "@/components/form-status";

// Start the return; review and sign it (spec step 126).

const BUTTON =
  "inline-flex h-11 items-center justify-center self-start rounded-full bg-emerald-700 px-5 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-60";

export function StartForm() {
  const [state, action, pending] = useActionState<FileState, FormData>(fileAction, null);
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="intent" value="start" />
      <button type="submit" disabled={pending} className={BUTTON}>
        Start my return
      </button>
      <FormStatus state={state} />
    </form>
  );
}

export function SignForm({ year }: { year: number }) {
  const [state, action, pending] = useActionState<FileState, FormData>(fileAction, null);
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="intent" value="sign" />
      <input type="hidden" name="year" value={year} />
      <label className="flex min-h-11 items-start gap-3">
        <input type="checkbox" name="reviewed" className="mt-1 size-5" />
        <span>
          I&apos;ve reviewed this return and, to the best of my knowledge, it&apos;s true, correct
          and complete.
        </span>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-sm">Sign with your full legal name</span>
        <input
          name="signature"
          autoComplete="name"
          className="h-11 rounded-lg border border-zinc-300 bg-white px-3 text-base dark:border-zinc-700 dark:bg-zinc-950"
        />
      </label>
      <button type="submit" disabled={pending} className={BUTTON}>
        Sign and file
      </button>
      <FormStatus state={state} />
    </form>
  );
}
